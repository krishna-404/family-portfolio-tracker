// Back-adjustment factors for price/quantity series. Raw bars are NEVER rewritten —
// adjusted series = raw values × cumulative factors, derived at read time. A value is
// adjusted by every action whose ex-date is STRICTLY AFTER the value's date (`date <
// exDate`): a trade the day before the ex-date adjusts, a trade ON the ex-date does not
// (kite_pnl's `==` comparison is the canonical regression).

import { qtyRatio } from "./apply";
import { formatDecimal8, mulDiv8, mulFixed8, parseDecimal8, SCALE } from "./decimal8";
import { liveActions } from "./replay";
import type { CorporateAction } from "./types";

export type AdjustmentFactor = {
	/** YYYY-MM-DD */
	exDate: string;
	/** Decimal string, 8dp: multiply historical quantities by this */
	qtyFactor: string;
	/** Decimal string, 8dp: multiply historical prices by this (= 1 / qtyFactor) */
	priceFactor: string;
	/** Product of this and every later factor — one lookup adjusts into current terms */
	cumulativeQtyFactor: string;
	/** Product of this and every later price factor */
	cumulativePriceFactor: string;
	sourceActionId: string;
};

// Only splits and bonuses adjust a continuous series; mergers/demergers change instrument
// identity and are handled by replay, not factor adjustment.
const FACTOR_TYPES = new Set<CorporateAction["type"]>(["split", "bonus"]);

/**
 * Factors sorted by ex-date ascending, cumulatives computed from the latest action
 * backward. Superseded actions are excluded.
 */
export function computeAdjustmentFactors(actions: CorporateAction[]): AdjustmentFactor[] {
	const relevant = liveActions(actions)
		.filter((action) => FACTOR_TYPES.has(action.type))
		.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));

	const factors: AdjustmentFactor[] = [];
	let cumulativeQty = SCALE;
	let cumulativePrice = SCALE;
	for (let i = relevant.length - 1; i >= 0; i--) {
		const action = relevant[i];
		if (action === undefined) continue;
		const { num, den } = qtyRatio(action);
		const qtyFactor = mulDiv8(SCALE, num, den);
		const priceFactor = mulDiv8(SCALE, den, num);
		cumulativeQty = mulFixed8(cumulativeQty, qtyFactor);
		cumulativePrice = mulFixed8(cumulativePrice, priceFactor);
		factors.unshift({
			exDate: action.exDate,
			qtyFactor: formatDecimal8(qtyFactor),
			priceFactor: formatDecimal8(priceFactor),
			cumulativeQtyFactor: formatDecimal8(cumulativeQty),
			cumulativePriceFactor: formatDecimal8(cumulativePrice),
			sourceActionId: action.id,
		});
	}
	return factors;
}

function adjust(
	value: string,
	date: string,
	factors: AdjustmentFactor[],
	pick: (factor: AdjustmentFactor) => string,
): string {
	// The earliest factor strictly after the date already folds in all later ones.
	const applicable = factors
		.filter((factor) => date < factor.exDate)
		.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0))[0];
	if (applicable === undefined) return formatDecimal8(parseDecimal8(value));
	return formatDecimal8(mulFixed8(parseDecimal8(value), parseDecimal8(pick(applicable))));
}

/** Adjust a historical quantity into current (post-action) terms. */
export function adjustQuantity(value: string, date: string, factors: AdjustmentFactor[]): string {
	return adjust(value, date, factors, (factor) => factor.cumulativeQtyFactor);
}

/** Adjust a historical price into current (post-action) terms. */
export function adjustPrice(value: string, date: string, factors: AdjustmentFactor[]): string {
	return adjust(value, date, factors, (factor) => factor.cumulativePriceFactor);
}
