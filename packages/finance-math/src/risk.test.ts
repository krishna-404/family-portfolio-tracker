import { describe, expect, it } from "vitest";
import {
	annualizedReturn,
	annualizedVolatility,
	maxDrawdown,
	sharpeRatio,
	sortinoRatio,
	TRADING_DAYS_PER_YEAR,
} from "./risk.js";
import type { DailyReturn } from "./twr.js";

function okValue(result: { status: string; value?: number }): number {
	if (result.status !== "ok" || result.value === undefined) {
		throw new Error(`expected ok, got ${result.status}`);
	}
	return result.value;
}

describe("annualizedVolatility", () => {
	it("is sample stdev x sqrt(252)", () => {
		// [0.01, -0.01]: mean 0, sample variance (1e-4 + 1e-4)/1 = 2e-4.
		const vol = okValue(annualizedVolatility([0.01, -0.01], 2));
		expect(vol).toBeCloseTo(Math.sqrt(2e-4) * Math.sqrt(TRADING_DAYS_PER_YEAR), 12);
	});
});

describe("sharpeRatio", () => {
	const returns = [0.01, -0.005, 0.02, 0.003, -0.01, 0.007];

	it("with rf = 0 equals annualized return / annualized volatility", () => {
		const sharpe = okValue(sharpeRatio(returns, 0, 2));
		const ann = okValue(annualizedReturn(returns, 2));
		const vol = okValue(annualizedVolatility(returns, 2));
		expect(sharpe).toBeCloseTo(ann / vol, 12);
	});

	it("subtracts the risk-free rate from the numerator", () => {
		const rf = 0.05;
		const sharpe = okValue(sharpeRatio(returns, rf, 2));
		const ann = okValue(annualizedReturn(returns, 2));
		const vol = okValue(annualizedVolatility(returns, 2));
		expect(sharpe).toBeCloseTo((ann - rf) / vol, 12);
	});
});

describe("sortinoRatio", () => {
	it("uses downside deviation over the full sample count", () => {
		const returns = [0.02, -0.01, 0.03, -0.02, 0.01];
		// downside^2 = (0.01^2 + 0.02^2)/5 = 1e-4; dd = 0.01 * sqrt(252)
		const dd = 0.01 * Math.sqrt(TRADING_DAYS_PER_YEAR);
		const growth = 1.02 * 0.99 * 1.03 * 0.98 * 1.01;
		const ann = growth ** (TRADING_DAYS_PER_YEAR / 5) - 1;
		expect(okValue(sortinoRatio(returns, 0, 2))).toBeCloseTo(ann / dd, 10);
	});
});

describe("maxDrawdown", () => {
	const series: DailyReturn[] = [
		{ date: "2024-01-01", value: 0.1 },
		{ date: "2024-01-02", value: -0.2 },
		{ date: "2024-01-03", value: 0.05 },
		{ date: "2024-01-04", value: -0.1 },
		{ date: "2024-01-05", value: 0.3 },
	];

	it("finds the deepest peak-to-trough decline with dates", () => {
		// Index: 1.1, 0.88, 0.924, 0.8316, 1.08108. Peak 1.1 (Jan 1),
		// trough 0.8316 (Jan 4): drawdown = 1 - 0.756 = 0.244.
		const result = maxDrawdown(series, 5);
		if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
		expect(result.drawdown).toBeCloseTo(0.244, 10);
		expect(result.peakDate).toBe("2024-01-01");
		expect(result.troughDate).toBe("2024-01-04");
	});

	it("reports zero drawdown on a monotonic rise", () => {
		const result = maxDrawdown(
			[
				{ date: "2024-01-01", value: 0.01 },
				{ date: "2024-01-02", value: 0.02 },
			],
			2,
		);
		if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
		expect(result.drawdown).toBe(0);
	});
});

describe("insufficient sample guard", () => {
	it("every metric returns the marker below the caller-supplied minimum", () => {
		const five = [0.01, 0.02, -0.01, 0.005, 0.001];
		const marker = { status: "insufficient_sample", sampleSize: 5, minimumSamples: 90 };
		expect(annualizedVolatility(five, 90)).toEqual(marker);
		expect(annualizedReturn(five, 90)).toEqual(marker);
		expect(sharpeRatio(five, 0, 90)).toEqual(marker);
		expect(sortinoRatio(five, 0, 90)).toEqual(marker);
		expect(
			maxDrawdown(
				five.map((value, i) => ({ date: `2024-01-0${i + 1}`, value })),
				90,
			),
		).toEqual(marker);
	});

	it("a single observation is never enough (stdev undefined)", () => {
		expect(annualizedVolatility([0.01], 1).status).toBe("insufficient_sample");
	});
});
