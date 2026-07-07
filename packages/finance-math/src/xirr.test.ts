import { describe, expect, it } from "vitest";
import { daysBetween, type Flow } from "./flows.js";
import { xirr, xnpv, zeroCrossingCount } from "./xirr.js";

function expectConverged(flows: readonly Flow[]): { rate: number; iterations: number } {
	const result = xirr(flows);
	if (result.status !== "converged") {
		throw new Error(`expected converged, got ${result.status}`);
	}
	return result;
}

describe("xnpv", () => {
	it("equals the plain sum at rate 0", () => {
		const flows: Flow[] = [
			{ date: "2024-01-01", amount: -1000 },
			{ date: "2024-06-01", amount: 400 },
			{ date: "2025-01-01", amount: 700 },
		];
		expect(xnpv(0, flows)).toBeCloseTo(100, 10);
	});

	it("discounts ACT/365F from the first flow date", () => {
		const flows: Flow[] = [
			{ date: "2024-01-01", amount: -1000 },
			{ date: "2024-12-31", amount: 1100 }, // exactly 365 days
		];
		expect(xnpv(0.1, flows)).toBeCloseTo(0, 10);
	});

	it("rejects rates at or below -1", () => {
		const flows: Flow[] = [
			{ date: "2024-01-01", amount: -1 },
			{ date: "2024-02-01", amount: 1 },
		];
		expect(() => xnpv(-1, flows)).toThrow(RangeError);
	});
});

describe("zeroCrossingCount", () => {
	it("counts sign changes in date order", () => {
		expect(
			zeroCrossingCount([
				{ date: "2024-01-01", amount: -1000 },
				{ date: "2024-06-01", amount: 500 },
				{ date: "2025-01-01", amount: -200 },
			]),
		).toBe(2);
	});

	it("nets same-day flows before counting", () => {
		expect(
			zeroCrossingCount([
				{ date: "2024-01-01", amount: -1000 },
				{ date: "2024-06-01", amount: 800 },
				{ date: "2024-06-01", amount: -900 }, // nets to -100: no crossing yet
				{ date: "2025-01-01", amount: 1200 },
			]),
		).toBe(1);
	});
});

describe("xirr: Excel reference fixture", () => {
	it("matches the Microsoft XIRR documentation example to 1e-6", () => {
		const flows: Flow[] = [
			{ date: "2008-01-01", amount: -10000 },
			{ date: "2008-03-01", amount: 2750 },
			{ date: "2008-10-30", amount: 4250 },
			{ date: "2009-02-15", amount: 3250 },
			{ date: "2009-04-01", amount: 2750 },
		];
		const { rate } = expectConverged(flows);
		expect(Math.abs(rate - 0.373362535)).toBeLessThan(1e-6);
	});
});

describe("xirr: two-flow closed form r = (FV/PV)^(365/days) - 1", () => {
	const cases: { start: string; end: string; fv: number }[] = [
		{ start: "2024-01-01", end: "2024-01-21", fv: 101000 }, // 20 days, < 30
		{ start: "2024-01-01", end: "2024-01-25", fv: 95000 }, // short tenor, negative return
		{ start: "2024-01-01", end: "2025-01-01", fv: 110000 }, // ~1 year (366 days)
		{ start: "2015-01-01", end: "2025-01-01", fv: 260000 }, // 10 years
		{ start: "2000-01-01", end: "2025-01-01", fv: 500000 }, // 25 years, > 20
	];
	const pv = 100000;

	for (const { start, end, fv } of cases) {
		it(`${start} -> ${end}, FV ${fv}`, () => {
			const days = daysBetween(start, end);
			const expected = (fv / pv) ** (365 / days) - 1;
			const flows: Flow[] = [
				{ date: start, amount: -pv },
				{ date: end, amount: fv },
			];
			const { rate } = expectConverged(flows);
			expect(Math.abs(rate - expected)).toBeLessThan(1e-9);
		});
	}
});

describe("xirr: SIP-style monthly flows", () => {
	it("finds a rate whose xnpv is ~0", () => {
		const flows: Flow[] = [];
		for (let month = 1; month <= 12; month++) {
			flows.push({ date: `2024-${String(month).padStart(2, "0")}-01`, amount: -10000 });
		}
		flows.push({ date: "2025-01-01", amount: 130000 });
		const { rate } = expectConverged(flows);
		expect(Math.abs(xnpv(rate, flows))).toBeLessThan(1e-6);
		// 120k in, 130k out with ~6.5 months average exposure: sanity band.
		expect(rate).toBeGreaterThan(0.1);
		expect(rate).toBeLessThan(0.25);
	});
});

describe("xirr: multiple roots", () => {
	// -1000, +3000, -2160 at 0/365/730 days: 1000x^2 - 3000x + 2160 = 0 for
	// x = 1+r, giving exact roots r = 0.2 and r = 0.8.
	const flows: Flow[] = [
		{ date: "2020-01-01", amount: -1000 },
		{ date: "2020-12-31", amount: 3000 },
		{ date: "2021-12-31", amount: -2160 },
	];

	it("returns status multiple_roots with the LOWEST rate", () => {
		const result = xirr(flows);
		expect(result.status).toBe("multiple_roots");
		if (result.status !== "multiple_roots") return;
		expect(result.roots).toHaveLength(2);
		expect(Math.abs(result.rate - 0.2)).toBeLessThan(1e-6);
		expect(result.rate).toBe(Math.min(...result.roots));
		const high = result.roots[1];
		expect(high).toBeDefined();
		if (high !== undefined) expect(Math.abs(high - 0.8)).toBeLessThan(1e-6);
	});

	it("every reported root actually solves xnpv to < 1e-6", () => {
		const result = xirr(flows);
		if (result.status !== "multiple_roots") throw new Error(`got ${result.status}`);
		for (const root of result.roots) {
			expect(Math.abs(xnpv(root, flows))).toBeLessThan(1e-6);
		}
	});
});

describe("xirr: degenerate inputs", () => {
	it("all-negative flows -> no_sign_change", () => {
		expect(
			xirr([
				{ date: "2024-01-01", amount: -1000 },
				{ date: "2024-06-01", amount: -500 },
			]),
		).toEqual({ status: "no_sign_change" });
	});

	it("all-positive flows -> no_sign_change", () => {
		expect(
			xirr([
				{ date: "2024-01-01", amount: 1000 },
				{ date: "2024-06-01", amount: 500 },
			]),
		).toEqual({ status: "no_sign_change" });
	});

	it("fewer than 2 flows throws", () => {
		expect(() => xirr([{ date: "2024-01-01", amount: -1000 }])).toThrow(/at least 2/);
	});

	it("same-day-only opposing flows: a clear error, not a crash or bogus rate", () => {
		expect(() =>
			xirr([
				{ date: "2024-01-01", amount: -1000 },
				{ date: "2024-01-01", amount: 1000 },
			]),
		).toThrow(/same day/);
	});

	it("same-day opposing flows inside a longer series net out and solve fine", () => {
		const flows: Flow[] = [
			{ date: "2024-01-01", amount: -1000 },
			{ date: "2024-07-01", amount: 300 },
			{ date: "2024-07-01", amount: -300 }, // nets to zero on the day
			{ date: "2024-12-31", amount: 1100 },
		];
		const { rate } = expectConverged(flows);
		expect(Math.abs(rate - 0.1)).toBeLessThan(1e-9);
	});
});
