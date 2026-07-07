import { describe, expect, it } from "vitest";
import { applyActionToPosition } from "./apply";
import type { CorporateAction, Position } from "./types";

function action(
	overrides: Partial<CorporateAction> & Pick<CorporateAction, "type">,
): CorporateAction {
	return { id: "ca-1", isin: "INE000A01010", exDate: "2024-01-10", ...overrides };
}

function position(quantity: string, costBasis: string): Position {
	return { isin: "INE000A01010", quantity, costBasis };
}

describe("bonus math uses BOTH ratio terms (kite_pnl regression)", () => {
	// A:B = A new per B held ⇒ ×(A+B)/B
	it.each([
		["1:1 doubles", 1, 1, "100", "200"],
		["1:2 → ×1.5", 1, 2, "100", "150"],
		["3:1 → ×4", 3, 1, "100", "400"],
		["32:21 → ×(53/21)", 32, 21, "21", "53"],
	])("%s", (_label, ratioNew, ratioOld, qty, expected) => {
		const result = applyActionToPosition(
			position(qty, "50000"),
			action({ type: "bonus", ratioNew, ratioOld }),
		);
		expect(result.position.quantity).toBe(expected);
		// Cost basis conserved every time.
		expect(result.position.costBasis).toBe("50000");
		expect(result.effect).toMatchObject({
			qtyBefore: qty,
			qtyAfter: expected,
			costBefore: "50000",
			costAfter: "50000",
		});
	});

	it("32:21 on a non-multiple holding surfaces the fractional remainder", () => {
		const result = applyActionToPosition(
			position("100", "50000"),
			action({ type: "bonus", ratioNew: 32, ratioOld: 21 }),
		);
		// 100 × 53/21 = 252.38095238…
		expect(result.position.quantity).toBe("252.38095238");
		expect(result.effect.fractionalRemainder).toBe("0.38095238");
		expect(result.position.costBasis).toBe("50000");
	});
});

describe("split math (face value old → new)", () => {
	it("FV 10 → 1: qty ×10, cost conserved (price implicitly ÷10)", () => {
		const result = applyActionToPosition(
			position("500", "48000"),
			action({ type: "split", ratioOld: 10, ratioNew: 1 }),
		);
		expect(result.position.quantity).toBe("5000");
		expect(result.position.costBasis).toBe("48000");
		// Per-share cost 96 → 9.6: the ÷10 price factor falls out of cost/qty.
		expect(Number(result.position.costBasis) / Number(result.position.quantity)).toBeCloseTo(
			9.6,
			10,
		);
		expect(result.effect.fractionalRemainder).toBe("0");
	});

	it("reverse split FV 1 → 10: qty ÷10 with fractionalRemainder surfaced, never floored", () => {
		const result = applyActionToPosition(
			position("125", "10000"),
			action({ type: "split", ratioOld: 1, ratioNew: 10 }),
		);
		expect(result.position.quantity).toBe("12.5");
		expect(result.effect.fractionalRemainder).toBe("0.5");
		expect(result.position.costBasis).toBe("10000");
	});

	it("throws on missing ratios instead of guessing", () => {
		expect(() => applyActionToPosition(position("100", "1000"), action({ type: "split" }))).toThrow(
			/ratios/,
		);
	});
});

describe("demerger cost apportionment", () => {
	it("0.30 → parent keeps 70%, child gets 30%, quantities 1:1 by default", () => {
		const result = applyActionToPosition(
			position("100", "90000"),
			action({ type: "demerger", costApportionment: 0.3, counterpartIsin: "INE000B01019" }),
		);
		expect(result.position).toEqual({
			isin: "INE000A01010",
			quantity: "100",
			costBasis: "63000",
		});
		expect(result.childPosition).toEqual({
			isin: "INE000B01019",
			quantity: "100",
			costBasis: "27000",
		});
		// Conservation: parent + child = original.
		expect(Number(result.position.costBasis) + Number(result.childPosition?.costBasis)).toBe(90000);
	});

	it("honors an explicit child entitlement ratio (1 child per 2 held)", () => {
		const result = applyActionToPosition(
			position("100", "90000"),
			action({
				type: "demerger",
				costApportionment: 0.3,
				counterpartIsin: "INE000B01019",
				ratioNew: 1,
				ratioOld: 2,
			}),
		);
		expect(result.childPosition?.quantity).toBe("50");
	});

	it("rejects apportionment outside [0, 1]", () => {
		expect(() =>
			applyActionToPosition(
				position("100", "1000"),
				action({ type: "demerger", costApportionment: 1.5, counterpartIsin: "INE000B01019" }),
			),
		).toThrow(/costApportionment/);
	});
});

describe("merger", () => {
	it("transfers to counterpart ISIN at the share ratio with cost carried", () => {
		const result = applyActionToPosition(
			position("100", "45000"),
			action({ type: "merger", ratioNew: 7, ratioOld: 10, counterpartIsin: "INE000C01018" }),
		);
		expect(result.position).toEqual({
			isin: "INE000C01018",
			quantity: "70",
			costBasis: "45000",
		});
	});
});

describe("non-position-affecting types", () => {
	it("dividend application throws — it has no quantity effect", () => {
		expect(() =>
			applyActionToPosition(position("100", "1000"), action({ type: "dividend" })),
		).toThrow(/no position application/);
	});
});
