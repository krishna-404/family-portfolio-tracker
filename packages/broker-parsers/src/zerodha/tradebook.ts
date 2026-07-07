import type { Exchange, TradeSide } from "@connected-repo/zod-schemas/enums.zod";
import { parseCsv } from "../csv.js";
import { isDecimalString, isValidDate, isValidIsin, type ParseResult, type RowError } from "../types.js";

/**
 * Zerodha Console tradebook CSV → normalized trade rows.
 *
 * Observed header (docs/research/broker-exports.md §1):
 *   symbol,isin,trade_date,exchange,segment,series,trade_type,auction,
 *   quantity,price,trade_id,order_id,order_execution_time
 *
 * One row per FILL; `trade_id` is the dedupe key, `order_id` groups fills.
 * The file carries NO charges — those attach later from the ledger.
 */
export interface ZerodhaTrade {
	symbol: string;
	/**
	 * Null when the file leaves the column blank — observed on real exports
	 * for fresh listings/SME scrips. The row is still a valid trade; the
	 * import pipeline's referential tier resolves the instrument by symbol
	 * or raises a mapping prompt. Only a MALFORMED non-empty ISIN is a row
	 * error.
	 */
	isin: string | null;
	/** YYYY-MM-DD */
	tradeDate: string;
	exchange: Exchange;
	segment: string;
	series: string;
	side: TradeSide;
	auction: boolean;
	/** Decimal strings — never floats; DB stores NUMERIC. */
	quantity: string;
	price: string;
	brokerTradeId: string;
	brokerOrderId: string;
	/**
	 * Verbatim `order_execution_time` (YYYY-MM-DDTHH:MM:SS, exchange-local
	 * IST, no offset in the file). Timezone attribution happens at ingest
	 * against the exchange calendar — not here.
	 */
	executedAt: string | null;
}

const EXPECTED_HEADER = [
	"symbol",
	"isin",
	"trade_date",
	"exchange",
	"segment",
	"series",
	"trade_type",
	"auction",
	"quantity",
	"price",
	"trade_id",
	"order_id",
	"order_execution_time",
];

export interface ZerodhaTradebookMeta {
	tradeDateSpan: { from: string; to: string } | null;
	segments: string[];
}

export function parseZerodhaTradebook(
	text: string,
): ParseResult<ZerodhaTrade, ZerodhaTradebookMeta> {
	const csv = parseCsv(text);
	const errors: RowError[] = csv.errors.map((e) => ({
		row: e.line,
		code: "csv_syntax",
		message: e.message,
	}));

	// Header check by CONTENT (Zerodha may append columns; reordering or
	// renaming the ones we consume is a format change we must fail loudly on).
	const idx = new Map(csv.header.map((h, i) => [h.trim(), i]));
	const missing = EXPECTED_HEADER.filter((h) => !idx.has(h));
	if (missing.length > 0) {
		errors.push({
			row: 0,
			code: "bad_header",
			message: `Not a Zerodha tradebook: missing column(s) ${missing.join(", ")}`,
		});
		return { rows: [], errors, meta: { tradeDateSpan: null, segments: [] } };
	}
	const col = (record: string[], name: string): string =>
		(record[idx.get(name) as number] ?? "").trim();

	const rows: ZerodhaTrade[] = [];
	csv.records.forEach((record, i) => {
		const row = i + 1;
		const fail = (code: RowError["code"], message: string) =>
			errors.push({ row, code, message });

		const isin = col(record, "isin");
		const tradeDate = col(record, "trade_date");
		const tradeType = col(record, "trade_type");
		const exchangeRaw = col(record, "exchange");
		const quantity = col(record, "quantity");
		const price = col(record, "price");
		const brokerTradeId = col(record, "trade_id");

		if (isin !== "" && !isValidIsin(isin)) {
			fail("bad_isin", `Invalid ISIN: ${isin}`);
			return;
		}
		if (!isValidDate(tradeDate)) {
			fail("bad_date", `Invalid trade_date: ${tradeDate}`);
			return;
		}
		if (tradeType !== "buy" && tradeType !== "sell") {
			fail("bad_enum", `Unknown trade_type: ${tradeType}`);
			return;
		}
		if (!isDecimalString(quantity) || Number(quantity) <= 0) {
			fail("bad_number", `Invalid quantity: ${quantity}`);
			return;
		}
		if (!isDecimalString(price) || Number(price) < 0) {
			fail("bad_number", `Invalid price: ${price}`);
			return;
		}
		if (brokerTradeId === "") {
			fail("missing_field", "Empty trade_id");
			return;
		}

		const exchange: Exchange =
			exchangeRaw === "NSE" || exchangeRaw === "BSE" ? exchangeRaw : "other";
		const executedAt = col(record, "order_execution_time");
		rows.push({
			symbol: col(record, "symbol"),
			isin: isin === "" ? null : isin,
			tradeDate,
			exchange,
			segment: col(record, "segment"),
			series: col(record, "series"),
			side: tradeType,
			auction: col(record, "auction") === "true",
			quantity,
			price,
			brokerTradeId,
			brokerOrderId: col(record, "order_id"),
			executedAt: executedAt === "" ? null : executedAt,
		});
	});

	const dates = rows.map((r) => r.tradeDate).sort();
	const first = dates[0];
	const last = dates[dates.length - 1];
	return {
		rows,
		errors,
		meta: {
			tradeDateSpan: first && last ? { from: first, to: last } : null,
			segments: [...new Set(rows.map((r) => r.segment))],
		},
	};
}
