import { parseCsv } from "../csv.js";
import { dec6 } from "../decimal6.js";
import { isDecimalString, isValidDate, type ParseResult, type RowError } from "../types.js";

/**
 * Zerodha Console ledger CSV → normalized ledger lines. This file is Kosh's
 * fund-flow ground truth (docs/research/broker-exports.md §2).
 *
 * Observed header:
 *   particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance
 *
 * First data row is `Opening Balance` and last is `Closing Balance` — both
 * dateless. They are anchors, not transactions: parsed into `meta`, excluded
 * from `rows`, and consumed by the balance-reproduction gate.
 */
export interface ZerodhaLedgerLine {
	/** 1-based data-row index in the file (anchors included in numbering). */
	row: number;
	particulars: string;
	/** YYYY-MM-DD */
	postingDate: string;
	costCenter: string;
	voucherType: string;
	/** Decimal strings at the file's native 6dp precision. */
	debit: string;
	credit: string;
	netBalance: string;
}

export interface ZerodhaLedgerMeta {
	openingBalance: string | null;
	closingBalance: string | null;
	postingDateSpan: { from: string; to: string } | null;
	voucherTypes: string[];
}

const EXPECTED_HEADER = [
	"particulars",
	"posting_date",
	"cost_center",
	"voucher_type",
	"debit",
	"credit",
	"net_balance",
];

export function parseZerodhaLedger(
	text: string,
): ParseResult<ZerodhaLedgerLine, ZerodhaLedgerMeta> {
	const csv = parseCsv(text);
	const errors: RowError[] = csv.errors.map((e) => ({
		row: e.line,
		code: "csv_syntax",
		message: e.message,
	}));
	const emptyMeta: ZerodhaLedgerMeta = {
		openingBalance: null,
		closingBalance: null,
		postingDateSpan: null,
		voucherTypes: [],
	};

	const idx = new Map(csv.header.map((h, i) => [h.trim(), i]));
	const missing = EXPECTED_HEADER.filter((h) => !idx.has(h));
	if (missing.length > 0) {
		errors.push({
			row: 0,
			code: "bad_header",
			message: `Not a Zerodha ledger: missing column(s) ${missing.join(", ")}`,
		});
		return { rows: [], errors, meta: emptyMeta };
	}
	const col = (record: string[], name: string): string =>
		(record[idx.get(name) as number] ?? "").trim();

	const rows: ZerodhaLedgerLine[] = [];
	let openingBalance: string | null = null;
	let closingBalance: string | null = null;

	csv.records.forEach((record, i) => {
		const row = i + 1;
		const particulars = col(record, "particulars");
		const netBalance = col(record, "net_balance");

		if (particulars === "Opening Balance" || particulars === "Closing Balance") {
			if (!isDecimalString(netBalance)) {
				errors.push({ row, code: "bad_number", message: `Bad anchor balance: ${netBalance}` });
				return;
			}
			if (particulars === "Opening Balance") openingBalance = netBalance;
			else closingBalance = netBalance;
			return;
		}

		const postingDate = col(record, "posting_date");
		const debit = col(record, "debit");
		const credit = col(record, "credit");
		const fail = (code: RowError["code"], message: string) =>
			errors.push({ row, code, message });

		if (!isValidDate(postingDate)) {
			fail("bad_date", `Invalid posting_date: ${postingDate}`);
			return;
		}
		if (!isDecimalString(debit)) {
			fail("bad_number", `Invalid debit: ${debit}`);
			return;
		}
		if (!isDecimalString(credit)) {
			fail("bad_number", `Invalid credit: ${credit}`);
			return;
		}
		if (!isDecimalString(netBalance)) {
			fail("bad_number", `Invalid net_balance: ${netBalance}`);
			return;
		}
		if (dec6(debit) !== 0n && dec6(credit) !== 0n) {
			fail("bad_number", "Row has both debit and credit");
			return;
		}

		rows.push({
			row,
			particulars,
			postingDate,
			costCenter: col(record, "cost_center"),
			voucherType: col(record, "voucher_type"),
			debit,
			credit,
			netBalance,
		});
	});

	const dates = rows.map((r) => r.postingDate).sort();
	const first = dates[0];
	const last = dates[dates.length - 1];
	return {
		rows,
		errors,
		meta: {
			openingBalance,
			closingBalance,
			postingDateSpan: first && last ? { from: first, to: last } : null,
			voucherTypes: [...new Set(rows.map((r) => r.voucherType))],
		},
	};
}
