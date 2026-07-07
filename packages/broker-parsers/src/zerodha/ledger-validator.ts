import { dec6, dec6ToString } from "../decimal6.js";
import type { RowError } from "../types.js";
import type { ZerodhaLedgerLine, ZerodhaLedgerMeta } from "./ledger.js";

/**
 * The ledger balance-reproduction gate: replay every line from the opening
 * balance (balance − debit + credit) and demand the file's own running
 * `net_balance` at every step, exactly, at the file's native 6dp — no float
 * tolerance. A single mismatch fails the whole file (validate-before-acting:
 * atomically applied or not at all), because it means rows are missing,
 * reordered, or corrupted — and any of those silently poisons fund-flow
 * returns downstream.
 */
export interface LedgerValidationResult {
	ok: boolean;
	errors: RowError[];
	/** Non-fatal observations (e.g. non-monotonic posting dates). */
	warnings: RowError[];
}

export function validateZerodhaLedgerBalances(
	rows: ZerodhaLedgerLine[],
	meta: ZerodhaLedgerMeta,
): LedgerValidationResult {
	const errors: RowError[] = [];
	const warnings: RowError[] = [];

	if (meta.openingBalance === null) {
		errors.push({ row: 0, code: "balance_mismatch", message: "Missing Opening Balance row" });
		return { ok: false, errors, warnings };
	}

	let running = dec6(meta.openingBalance);
	let prevDate = "";
	for (const line of rows) {
		running = running - dec6(line.debit) + dec6(line.credit);
		const stated = dec6(line.netBalance);
		if (running !== stated) {
			errors.push({
				row: line.row,
				code: "balance_mismatch",
				message:
					`Running balance ${dec6ToString(running)} != stated ${line.netBalance} ` +
					`at "${line.particulars.slice(0, 60)}" — file has missing, reordered, or corrupt rows`,
			});
			// One mismatch corrupts every subsequent comparison; stop here.
			return { ok: false, errors, warnings };
		}
		if (prevDate && line.postingDate < prevDate) {
			warnings.push({
				row: line.row,
				code: "bad_date",
				message: `posting_date ${line.postingDate} earlier than previous row (${prevDate})`,
			});
		}
		prevDate = line.postingDate;
	}

	if (meta.closingBalance !== null && running !== dec6(meta.closingBalance)) {
		errors.push({
			row: 0,
			code: "balance_mismatch",
			message: `Final balance ${dec6ToString(running)} != Closing Balance ${meta.closingBalance}`,
		});
	}

	return { ok: errors.length === 0, errors, warnings };
}
