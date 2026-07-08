import { describe, expect, it } from "vitest";
import type { Flow } from "./flows.js";
import { twr, type ValuationPoint } from "./twr.js";
import { xirr } from "./xirr.js";

// Hand-computed fixture: 1000 grows 10% per period for two periods, with a
// 500 deposit arriving either at the first or the second period.
// Dates a year apart so the periods are legible; the math is date-agnostic.
const D0 = "2022-01-01";
const D1 = "2023-01-01";
const D2 = "2024-01-01";

// Deposit at start of period 1: r1 = (1650+0)/(1000+500)-1 = 0.1; r2 = 1815/1650-1 = 0.1
const earlyDeposit: ValuationPoint[] = [
	{ date: D0, value: 1000, inflow: 0, outflow: 0 },
	{ date: D1, value: 1650, inflow: 500, outflow: 0 },
	{ date: D2, value: 1815, inflow: 0, outflow: 0 },
];

// Deposit at start of period 2: r1 = 1100/1000-1 = 0.1; r2 = 1760/(1100+500)-1 = 0.1
const lateDeposit: ValuationPoint[] = [
	{ date: D0, value: 1000, inflow: 0, outflow: 0 },
	{ date: D1, value: 1100, inflow: 0, outflow: 0 },
	{ date: D2, value: 1760, inflow: 500, outflow: 0 },
];

describe("twr", () => {
	it("links daily returns: two 10% periods -> 21% cumulative", () => {
		const result = twr(earlyDeposit);
		expect(result.cumulative).toBeCloseTo(0.21, 12);
		expect(result.days).toBe(730);
		expect(result.dailyReturns.map((r) => r.value)).toEqual([
			expect.closeTo(0.1, 12),
			expect.closeTo(0.1, 12),
		]);
		// (1.21)^(365/730) - 1 = 0.1
		expect(result.annualized).toBeCloseTo(0.1, 12);
		expect(result.zeroDenominatorDays).toEqual([]);
	});

	it("is invariant to deposit timing (manager skill, not investor timing)", () => {
		expect(twr(earlyDeposit).cumulative).toBeCloseTo(twr(lateDeposit).cumulative, 12);
	});

	it("flags zero-denominator days and treats them as r = 0", () => {
		const result = twr([
			{ date: "2024-01-01", value: 0, inflow: 0, outflow: 0 },
			{ date: "2024-01-02", value: 0, inflow: 0, outflow: 0 },
			{ date: "2024-01-03", value: 110, inflow: 100, outflow: 0 },
		]);
		expect(result.zeroDenominatorDays).toEqual(["2024-01-02"]);
		expect(result.dailyReturns.map((r) => r.value)).toEqual([0, expect.closeTo(0.1, 12)]);
		expect(result.cumulative).toBeCloseTo(0.1, 12);
	});

	it("requires at least two points and unique dates", () => {
		expect(() => twr([{ date: D0, value: 1, inflow: 0, outflow: 0 }])).toThrow(/at least 2/);
		expect(() =>
			twr([
				{ date: D0, value: 1, inflow: 0, outflow: 0 },
				{ date: D0, value: 2, inflow: 0, outflow: 0 },
			]),
		).toThrow(/Duplicate/);
	});
});

describe("deposit timing changes XIRR but not TWR on the same data", () => {
	// The same two scenarios expressed as investor-pocket flows for XIRR:
	// opening value pseudo-outflow, deposits negative, closing value positive.
	const earlyFlows: Flow[] = [
		{ date: D0, amount: -1000 },
		{ date: D1, amount: -500 },
		{ date: D2, amount: 1815 },
	];
	const lateFlows: Flow[] = [
		{ date: D0, amount: -1000 },
		{ date: D2, amount: -500 },
		{ date: D2, amount: 1760 },
	];

	it("XIRR differs across the scenarios while TWR is identical", () => {
		const early = xirr(earlyFlows);
		const late = xirr(lateFlows);
		if (early.status !== "converged" || late.status !== "converged") {
			throw new Error(`expected both converged, got ${early.status}/${late.status}`);
		}
		// Closed forms: 1000x^2 + 500x = 1815 and 1000x^2 = 1260 for x = 1+r.
		const expectedEarly = (-500 + Math.sqrt(500 ** 2 + 4 * 1000 * 1815)) / 2000 - 1;
		const expectedLate = Math.sqrt(1.26) - 1;
		expect(Math.abs(early.rate - expectedEarly)).toBeLessThan(1e-9);
		expect(Math.abs(late.rate - expectedLate)).toBeLessThan(1e-9);
		expect(Math.abs(early.rate - late.rate)).toBeGreaterThan(1e-3);
		expect(twr(earlyDeposit).cumulative).toBeCloseTo(twr(lateDeposit).cumulative, 12);
	});
});
