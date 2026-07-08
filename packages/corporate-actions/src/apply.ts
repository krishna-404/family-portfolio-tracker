// Position application math for split / bonus / merger / demerger. Pure derivation — the
// input position is NEVER mutated (Portfolio Performance's history-rewriting split wizard is
// the anti-pattern). All values are decimal strings; bigint fixed-point at 8dp internally.

import { formatDecimal8, mulDiv8, mulFixed8, parseDecimal8, SCALE } from "./decimal8";
import type { CorporateAction, Position } from "./types";

export type ApplyEffect = {
	qtyBefore: string;
	qtyAfter: string;
	costBefore: string;
	costAfter: string;
	/**
	 * Fractional-share entitlement (qtyAfter minus its whole part). Companies pay cash for
	 * fractions — the caller must surface this as a user prompt; the kernel never floors.
	 */
	fractionalRemainder: string;
};

export type ApplyResult = {
	position: Position;
	/** Demerger only: the spun-off child position */
	childPosition?: Position;
	effect: ApplyEffect;
};

/** Quantity ratio as an exact bigint rational; the fixed-8 scale cancels in num/den. */
export function qtyRatio(action: CorporateAction): { num: bigint; den: bigint } {
	const { ratioOld, ratioNew } = action;
	if (ratioOld === undefined || ratioNew === undefined || !(ratioOld > 0) || !(ratioNew > 0)) {
		throw new Error(
			`corporate-actions: action ${action.id} (${action.type}) needs positive ratios`,
		);
	}
	const oldScaled = parseDecimal8(String(ratioOld));
	const newScaled = parseDecimal8(String(ratioNew));
	switch (action.type) {
		// Face value old → new: FV 10 → 1 ⇒ one share becomes 10.
		case "split":
			return { num: oldScaled, den: newScaled };
		// A:B = A new per B held ⇒ ×(A+B)/B. BOTH terms matter (kite_pnl regression).
		case "bonus":
			return { num: newScaled + oldScaled, den: oldScaled };
		// ratioNew counterpart shares per ratioOld held.
		case "merger":
		case "demerger":
			return { num: newScaled, den: oldScaled };
		default:
			throw new Error(`corporate-actions: no quantity ratio for type "${action.type}"`);
	}
}

function fractionalPart(scaledQty: bigint): bigint {
	const abs = scaledQty < 0n ? -scaledQty : scaledQty;
	return abs % SCALE;
}

function effect(
	qtyBefore: bigint,
	qtyAfter: bigint,
	costBefore: bigint,
	costAfter: bigint,
): ApplyEffect {
	return {
		qtyBefore: formatDecimal8(qtyBefore),
		qtyAfter: formatDecimal8(qtyAfter),
		costBefore: formatDecimal8(costBefore),
		costAfter: formatDecimal8(costAfter),
		fractionalRemainder: formatDecimal8(fractionalPart(qtyAfter)),
	};
}

/**
 * Derive the post-action position(s). Supported types: split, bonus (cost basis conserved,
 * quantity scaled), merger (holding transfers to counterpart ISIN at the share ratio, cost
 * carried), demerger (cost split by `costApportionment`; parent and child both returned).
 * Other action types have no deterministic position effect and throw.
 */
export function applyActionToPosition(position: Position, action: CorporateAction): ApplyResult {
	const qty = parseDecimal8(position.quantity);
	const cost = parseDecimal8(position.costBasis);

	switch (action.type) {
		case "split":
		case "bonus": {
			const { num, den } = qtyRatio(action);
			const qtyAfter = mulDiv8(qty, num, den);
			// Cost basis is CONSERVED across splits and bonuses — only the share count changes.
			const after: Position = {
				isin: position.isin,
				quantity: formatDecimal8(qtyAfter),
				costBasis: formatDecimal8(cost),
			};
			if (parseDecimal8(after.costBasis) !== cost) {
				throw new Error("corporate-actions: cost conservation violated");
			}
			return { position: after, effect: effect(qty, qtyAfter, cost, cost) };
		}
		case "merger": {
			if (action.counterpartIsin === undefined) {
				throw new Error(`corporate-actions: merger ${action.id} needs counterpartIsin`);
			}
			const { num, den } = qtyRatio(action);
			const qtyAfter = mulDiv8(qty, num, den);
			return {
				position: {
					isin: action.counterpartIsin,
					quantity: formatDecimal8(qtyAfter),
					costBasis: formatDecimal8(cost),
				},
				effect: effect(qty, qtyAfter, cost, cost),
			};
		}
		case "demerger": {
			const apportionment = action.costApportionment;
			if (action.counterpartIsin === undefined) {
				throw new Error(`corporate-actions: demerger ${action.id} needs counterpartIsin`);
			}
			if (apportionment === undefined || apportionment < 0 || apportionment > 1) {
				throw new Error(
					`corporate-actions: demerger ${action.id} needs costApportionment in [0, 1]`,
				);
			}
			// Child cost rounds; parent takes the exact remainder so total cost is conserved.
			const childCost = mulFixed8(cost, parseDecimal8(String(apportionment)));
			const parentCost = cost - childCost;
			const hasRatio = action.ratioOld !== undefined && action.ratioNew !== undefined;
			const childQty = hasRatio ? mulDiv8(qty, qtyRatio(action).num, qtyRatio(action).den) : qty;
			return {
				position: {
					isin: position.isin,
					quantity: position.quantity,
					costBasis: formatDecimal8(parentCost),
				},
				childPosition: {
					isin: action.counterpartIsin,
					quantity: formatDecimal8(childQty),
					costBasis: formatDecimal8(childCost),
				},
				effect: effect(qty, qty, cost, parentCost),
			};
		}
		default:
			throw new Error(
				`corporate-actions: type "${action.type}" has no position application (action ${action.id})`,
			);
	}
}
