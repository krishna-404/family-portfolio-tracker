import { describe, expect, it } from "vitest";
import { reconcileHoldings } from "./reconcile";
import { replayPositions } from "./replay";
import type { CorporateAction, Trade } from "./types";

describe("reconcileHoldings", () => {
	it("matching holdings produce no discrepancies", () => {
		expect(
			reconcileHoldings(
				[{ isin: "INE075A01022", quantity: "100", costBasis: "40000" }],
				[{ isin: "INE075A01022", quantity: "100" }],
			),
		).toEqual([]);
	});

	it("a missed action produces exactly the expected discrepancy row", () => {
		const trades: Trade[] = [
			{ isin: "INE075A01022", date: "2023-01-02", side: "buy", quantity: "100", price: "400" },
		];
		// The feed missed a 1:1 bonus — expected holdings come from a bonus-less replay,
		// while the broker reports the post-bonus quantity. Reconciliation is the guarantee.
		const missedBonus: CorporateAction[] = [];
		const expected = replayPositions(trades, missedBonus, "2023-12-31");
		const diffs = reconcileHoldings(expected, [{ isin: "INE075A01022", quantity: "200" }]);
		expect(diffs).toEqual([
			{ isin: "INE075A01022", expectedQty: "100", reportedQty: "200", diff: "100" },
		]);
	});

	it("includes ISINs present on either side only, as zero on the missing side", () => {
		const diffs = reconcileHoldings(
			[{ isin: "INE0AAA01011", quantity: "50", costBasis: "5000" }],
			[{ isin: "INE0BBB01019", quantity: "25" }],
		);
		expect(diffs).toEqual([
			{ isin: "INE0AAA01011", expectedQty: "50", reportedQty: "0", diff: "-50" },
			{ isin: "INE0BBB01019", expectedQty: "0", reportedQty: "25", diff: "25" },
		]);
	});

	it("handles fractional quantities exactly", () => {
		const diffs = reconcileHoldings(
			[{ isin: "INF0MF001019", quantity: "104.523", costBasis: "10000" }],
			[{ isin: "INF0MF001019", quantity: "104.5231" }],
		);
		expect(diffs).toEqual([
			{ isin: "INF0MF001019", expectedQty: "104.523", reportedQty: "104.5231", diff: "0.0001" },
		]);
	});
});
