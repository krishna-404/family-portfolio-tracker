import { describe, expect, it } from "vitest";
import { adjustPrice, adjustQuantity, computeAdjustmentFactors } from "./adjustment";
import type { CorporateAction } from "./types";

const SPLIT_10_TO_1: CorporateAction = {
	id: "ca-split",
	isin: "INE000A01010",
	type: "split",
	exDate: "2024-06-15",
	ratioOld: 10,
	ratioNew: 1,
};

const BONUS_1_1: CorporateAction = {
	id: "ca-bonus",
	isin: "INE000A01010",
	type: "bonus",
	exDate: "2023-03-01",
	ratioNew: 1,
	ratioOld: 1,
};

describe("computeAdjustmentFactors", () => {
	it("emits per-action and cumulative factors, ascending by ex-date", () => {
		const factors = computeAdjustmentFactors([SPLIT_10_TO_1, BONUS_1_1]);
		expect(factors).toEqual([
			{
				exDate: "2023-03-01",
				qtyFactor: "2",
				priceFactor: "0.5",
				cumulativeQtyFactor: "20",
				cumulativePriceFactor: "0.05",
				sourceActionId: "ca-bonus",
			},
			{
				exDate: "2024-06-15",
				qtyFactor: "10",
				priceFactor: "0.1",
				cumulativeQtyFactor: "10",
				cumulativePriceFactor: "0.1",
				sourceActionId: "ca-split",
			},
		]);
	});

	it("rounds odd ratios at 8dp (bonus 32:21 → 53/21)", () => {
		const factors = computeAdjustmentFactors([{ ...BONUS_1_1, ratioNew: 32, ratioOld: 21 }]);
		expect(factors[0]?.qtyFactor).toBe("2.52380952");
	});

	it("skips superseded actions and non-factor types", () => {
		const factors = computeAdjustmentFactors([
			{ ...SPLIT_10_TO_1, supersededById: "ca-corrected" },
			{ ...BONUS_1_1, id: "ca-div", type: "dividend", amountPerShare: "8" },
		]);
		expect(factors).toEqual([]);
	});
});

describe("adjustment date boundary (kite_pnl == regression)", () => {
	const factors = computeAdjustmentFactors([SPLIT_10_TO_1]);

	it("a trade the day BEFORE the ex-date adjusts", () => {
		expect(adjustQuantity("500", "2024-06-14", factors)).toBe("5000");
		expect(adjustPrice("960", "2024-06-14", factors)).toBe("96");
	});

	it("a trade ON the ex-date does NOT adjust", () => {
		expect(adjustQuantity("500", "2024-06-15", factors)).toBe("500");
		expect(adjustPrice("96", "2024-06-15", factors)).toBe("96");
	});

	it("a trade after the ex-date does not adjust", () => {
		expect(adjustQuantity("500", "2024-06-16", factors)).toBe("500");
	});

	it("a trade before BOTH actions gets the cumulative factor", () => {
		const both = computeAdjustmentFactors([SPLIT_10_TO_1, BONUS_1_1]);
		expect(adjustQuantity("100", "2023-02-28", both)).toBe("2000");
		expect(adjustPrice("1000", "2023-02-28", both)).toBe("50");
	});

	it("a trade between the two actions gets only the later factor", () => {
		const both = computeAdjustmentFactors([SPLIT_10_TO_1, BONUS_1_1]);
		expect(adjustQuantity("100", "2023-03-01", both)).toBe("1000");
	});
});
