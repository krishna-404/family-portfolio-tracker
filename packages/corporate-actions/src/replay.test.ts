import { describe, expect, it } from "vitest";
import { liveActions, replayPositions } from "./replay";
import type { CorporateAction, Trade } from "./types";

const WIPRO = "INE075A01022";

function trade(overrides: Partial<Trade>): Trade {
	return {
		isin: WIPRO,
		date: "2023-01-02",
		side: "buy",
		quantity: "100",
		price: "400",
		...overrides,
	};
}

describe("liveActions", () => {
	it("filters superseded actions; nothing is deleted", () => {
		const wrong: CorporateAction = {
			id: "ca-wrong",
			isin: WIPRO,
			type: "split",
			exDate: "2023-06-01",
			ratioOld: 1,
			ratioNew: 10,
			supersededById: "ca-right",
		};
		const right: CorporateAction = { ...wrong, id: "ca-right", ratioOld: 5, supersededById: null };
		expect(liveActions([wrong, right])).toEqual([right]);
	});
});

describe("replayPositions — WIPRO-like sequence, hand-verified", () => {
	const trades: Trade[] = [
		trade({ date: "2023-01-02", quantity: "100", price: "500" }), // cost 50,000
		trade({ date: "2023-02-01", quantity: "100", price: "300" }), // cost 30,000 → 200 @ 80,000
		trade({ date: "2023-09-01", side: "sell", quantity: "100", price: "250" }),
	];
	const bonus: CorporateAction = {
		id: "ca-bonus",
		isin: WIPRO,
		type: "bonus",
		exDate: "2023-06-01",
		ratioNew: 1,
		ratioOld: 1,
	};

	it("buys → 1:1 bonus → sell: holdings and average-cost basis", () => {
		// After bonus: 400 shares, cost 80,000 (avg 200). Sell 100 removes 20,000.
		expect(replayPositions(trades, [bonus], "2023-12-31")).toEqual([
			{ isin: WIPRO, quantity: "300", costBasis: "60000" },
		]);
	});

	it("asOf before the bonus ex-date sees unadjusted holdings (record-date holdings)", () => {
		expect(replayPositions(trades, [bonus], "2023-05-31")).toEqual([
			{ isin: WIPRO, quantity: "200", costBasis: "80000" },
		]);
	});

	it("action applies at the START of its ex-date — a buy ON the ex-date is post-bonus", () => {
		const exDayBuy = trade({ date: "2023-06-01", quantity: "50", price: "250" });
		const result = replayPositions([trades[0] as Trade, exDayBuy], [bonus], "2023-06-30");
		// 100 → bonus → 200 (cost 50,000), then +50 @ 250 (cost 12,500).
		expect(result).toEqual([{ isin: WIPRO, quantity: "250", costBasis: "62500" }]);
	});

	it("fails loudly on oversell instead of going negative", () => {
		const oversell = trade({ date: "2023-03-01", side: "sell", quantity: "500" });
		expect(() => replayPositions([trades[0] as Trade, oversell], [], "2023-12-31")).toThrow(
			/exceeds holding/,
		);
	});
});

describe("retract-and-reapply heals byte-identically", () => {
	const trades: Trade[] = [
		trade({ date: "2023-01-02", quantity: "120", price: "500" }),
		trade({ date: "2023-04-01", quantity: "80", price: "450" }),
	];
	const bonus: CorporateAction = {
		id: "ca-bonus",
		isin: WIPRO,
		type: "bonus",
		exDate: "2023-05-01",
		ratioNew: 1,
		ratioOld: 2,
	};
	const wrongAction: CorporateAction = {
		id: "ca-wrong",
		isin: WIPRO,
		type: "split",
		exDate: "2023-08-01",
		ratioOld: 10,
		ratioNew: 1,
		supersededById: "ca-corrected",
	};
	const correctedAction: CorporateAction = {
		id: "ca-corrected",
		isin: WIPRO,
		type: "split",
		exDate: "2023-08-01",
		ratioOld: 5,
		ratioNew: 1,
	};

	it("replay(trades, [..., wrong (superseded), corrected]) ≡ replay(trades, [..., corrected])", () => {
		const withRetracted = replayPositions(
			trades,
			[bonus, wrongAction, correctedAction],
			"2023-12-31",
		);
		const withoutRetracted = replayPositions(trades, [bonus, correctedAction], "2023-12-31");
		expect(JSON.stringify(withRetracted)).toBe(JSON.stringify(withoutRetracted));
		// And the healed value itself is right: 200 ×1.5 = 300, ×5 = 1500.
		expect(withRetracted).toEqual([{ isin: WIPRO, quantity: "1500", costBasis: "96000" }]);
	});
});

describe("demerger in replay", () => {
	it("child position appears in replay output with apportioned cost", () => {
		const demerger: CorporateAction = {
			id: "ca-demerger",
			isin: WIPRO,
			type: "demerger",
			exDate: "2023-07-01",
			costApportionment: 0.3,
			counterpartIsin: "INE123X01014",
		};
		const result = replayPositions(
			[trade({ quantity: "100", price: "900" })],
			[demerger],
			"2023-12-31",
		);
		expect(result).toEqual([
			{ isin: WIPRO, quantity: "100", costBasis: "63000" },
			{ isin: "INE123X01014", quantity: "100", costBasis: "27000" },
		]);
	});
});

describe("merger in replay", () => {
	it("holding moves to the counterpart ISIN and merges with an existing stake", () => {
		const target = "INE002A01018";
		const merger: CorporateAction = {
			id: "ca-merger",
			isin: WIPRO,
			type: "merger",
			exDate: "2023-07-01",
			ratioNew: 1,
			ratioOld: 2,
			counterpartIsin: target,
		};
		const result = replayPositions(
			[
				trade({ quantity: "100", price: "400" }), // WIPRO: cost 40,000
				trade({ isin: target, quantity: "10", price: "1000" }), // target: cost 10,000
			],
			[merger],
			"2023-12-31",
		);
		expect(result).toEqual([{ isin: target, quantity: "60", costBasis: "50000" }]);
	});
});

describe("dividend actions never change positions in replay", () => {
	it("holdings are identical with and without a dividend action", () => {
		const dividend: CorporateAction = {
			id: "ca-div",
			isin: WIPRO,
			type: "dividend",
			exDate: "2023-06-01",
			amountPerShare: "8",
		};
		expect(replayPositions([trade({})], [dividend], "2023-12-31")).toEqual(
			replayPositions([trade({})], [], "2023-12-31"),
		);
	});
});
