// Kernel domain types. This package is PURE: types in, values out — no DB, no IO.
// No suitable enum exists in @connected-repo/zod-schemas/enums.zod, so the type is defined here.

export type CorporateActionType =
	| "split"
	| "bonus"
	| "dividend"
	| "merger"
	| "demerger"
	| "rights"
	| "buyback"
	| "symbol_change"
	| "delisting";

/**
 * A market-level corporate action fact. NEVER mutated after creation — corrections happen by
 * supersession (`supersededById` points at the replacement) and derived state is replayed.
 *
 * Ratio semantics (`ratioOld` / `ratioNew`) PER TYPE — read carefully, they differ:
 *
 * - split: FACE VALUES, old → new. "Face Value Split From Rs.10 To Re.1" ⇒ ratioOld=10,
 *   ratioNew=1. One share becomes ratioOld/ratioNew shares (FV ₹10 → ₹1 means 1 share
 *   becomes 10 shares). qtyFactor = ratioOld / ratioNew; priceFactor = ratioNew / ratioOld.
 *   A reverse split is ratioOld < ratioNew (FV ₹1 → ₹10 ⇒ qtyFactor = 1/10).
 *
 * - bonus: exchange notation A:B = A NEW shares per B HELD. ratioNew=A, ratioOld=B.
 *   qtyFactor = (A + B) / B — BOTH terms are load-bearing (kite_pnl ignored `old` and broke
 *   every non-1:N ratio). Bonus 1:1 ⇒ ×2; 1:2 ⇒ ×1.5; 3:1 ⇒ ×4; 32:21 ⇒ ×53/21.
 *   priceFactor = B / (A + B).
 *
 * - rights: A:B = entitlement to A new shares per B held (same notation as bonus).
 *   ratioNew=A, ratioOld=B. No automatic quantity effect — subscription is a user decision.
 *   `amountPerShare` carries the issue premium when parsed.
 *
 * - merger: share exchange ratio — holders receive ratioNew shares of `counterpartIsin`
 *   per ratioOld shares held. qtyFactor = ratioNew / ratioOld.
 *
 * - demerger: ratios (when present) are the child entitlement — ratioNew child shares per
 *   ratioOld parent shares held (default 1:1 when absent). `costApportionment` is the
 *   fraction of the parent's cost basis that moves to the child (`counterpartIsin`).
 *
 * - dividend / buyback: `amountPerShare` (decimal string), no ratios.
 */
export type CorporateAction = {
	id: string;
	isin: string;
	type: CorporateActionType;
	/** YYYY-MM-DD */
	exDate: string;
	/** YYYY-MM-DD */
	recordDate?: string;
	/** YYYY-MM-DD */
	payDate?: string;
	ratioOld?: number;
	ratioNew?: number;
	/** Decimal string, e.g. "8" or "5.50" */
	amountPerShare?: string;
	/** Demerger: fraction of cost basis moving to the child, in [0, 1] */
	costApportionment?: number;
	/** Merger target / demerged child ISIN */
	counterpartIsin?: string;
	/** The verbatim feed purpose string the action was parsed from */
	rawText?: string;
	/** Set when this action was retracted; live actions have null/undefined */
	supersededById?: string | null;
};

export type Trade = {
	isin: string;
	/** YYYY-MM-DD */
	date: string;
	side: "buy" | "sell";
	/** Decimal string */
	quantity: string;
	/** Decimal string */
	price: string;
};

export type Position = {
	isin: string;
	/** Decimal string */
	quantity: string;
	/** Decimal string — total cost, not per-share */
	costBasis: string;
};
