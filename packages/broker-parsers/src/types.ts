/**
 * Shared result shapes for every broker parser. Parsers are PURE: text in,
 * normalized rows + row-level errors out. They never touch a database and
 * never throw for data problems — a malformed row becomes a `RowError` so
 * the import pipeline can quarantine it (validate-before-acting: a file is
 * applied atomically or not at all; the caller decides based on `errors`).
 */
export interface RowError {
	/** 1-based data-row index (excluding the header row). */
	row: number;
	code:
		| "bad_header"
		| "missing_field"
		| "bad_date"
		| "bad_number"
		| "bad_enum"
		| "bad_isin"
		| "balance_mismatch"
		| "csv_syntax";
	message: string;
}

export interface ParseResult<TRow, TMeta = Record<string, never>> {
	rows: TRow[];
	errors: RowError[];
	meta: TMeta;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** ISO date (YYYY-MM-DD) that is also a real calendar date. */
export function isValidDate(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
export function isDecimalString(s: string): boolean {
	return DECIMAL_RE.test(s);
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
export function isValidIsin(s: string): boolean {
	return ISIN_RE.test(s);
}
