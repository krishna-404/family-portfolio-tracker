import type { CashFlowClassification } from "@connected-repo/zod-schemas/enums.zod";

/**
 * A dated cash flow in the INVESTOR'S-POCKET sign convention:
 * money leaving the investor's pocket (deposits, purchases funded externally)
 * is NEGATIVE; money returning to the pocket or value the investor holds
 * (withdrawals, terminal valuation) is POSITIVE. XIRR over such flows reads
 * directly as the investor's return.
 */
export type Flow = {
	/** Calendar date, YYYY-MM-DD (no time component, no timezone). */
	date: string;
	amount: number;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parse a YYYY-MM-DD string to a UTC-midnight epoch-ms timestamp.
 * Rejects malformed strings and impossible calendar dates (e.g. 2024-02-30),
 * which `Date` would otherwise silently roll over.
 */
export function utcMidnightMs(date: string): number {
	const m = DATE_RE.exec(date);
	if (!m) throw new Error(`Not a YYYY-MM-DD date: "${date}"`);
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const ms = Date.UTC(year, month - 1, day);
	const check = new Date(ms);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		throw new Error(`Not a real calendar date: "${date}"`);
	}
	return ms;
}

/**
 * Whole days from `a` to `b` (negative when b precedes a). Pure UTC date
 * math — immune to local timezone and DST, always an integer.
 */
export function daysBetween(a: string, b: string): number {
	return (utcMidnightMs(b) - utcMidnightMs(a)) / MS_PER_DAY;
}

/**
 * Whether a ledger cash-flow classification is an EXTERNAL flow — i.e. it
 * crosses the boundary of the investor's pocket and therefore enters
 * money-weighted return math. Everything else is internal to the portfolio.
 *
 * The switch is deliberately exhaustive with a throwing default: adding a new
 * CASH_FLOW_CLASSIFICATION_ENUM value fails compilation here until someone
 * decides whether it is external. Never silently misclassify (spec §1).
 */
export function isExternalFlow(classification: CashFlowClassification): boolean {
	switch (classification) {
		case "external_deposit":
		case "external_withdrawal":
			return true;
		case "internal_transfer":
		case "dividend_receipt":
		case "fee_external":
		case "trade_settlement":
		case "charge":
		case "interest":
		case "other_internal":
			return false;
		default: {
			const unmapped = classification satisfies never;
			throw new Error(`Unmapped cash flow classification: ${String(unmapped)}`);
		}
	}
}
