import type { DailyReturn } from "./twr.js";

export const TRADING_DAYS_PER_YEAR = 252;

/**
 * Returned instead of a number when the sample is shorter than the
 * caller-supplied minimum — risk figures on tiny windows are noise, and the
 * UI must render an "insufficient sample" badge rather than a value (spec §7).
 */
export type InsufficientSample = {
	status: "insufficient_sample";
	sampleSize: number;
	minimumSamples: number;
};

export type RiskValue = { status: "ok"; value: number };

export type MaxDrawdownResult = {
	status: "ok";
	/** Positive magnitude: 0.25 means a 25% peak-to-trough decline. */
	drawdown: number;
	peakDate: string;
	troughDate: string;
};

function guard(sampleSize: number, minimumSamples: number): InsufficientSample | undefined {
	// stdev needs at least 2 observations regardless of what the caller asks for.
	if (sampleSize < Math.max(minimumSamples, 2)) {
		return { status: "insufficient_sample", sampleSize, minimumSamples };
	}
	return undefined;
}

function sampleStdev(returns: readonly number[]): number {
	const n = returns.length;
	let mean = 0;
	for (const r of returns) mean += r;
	mean /= n;
	let sq = 0;
	for (const r of returns) sq += (r - mean) ** 2;
	return Math.sqrt(sq / (n - 1));
}

function compoundAnnualized(returns: readonly number[]): number {
	let growth = 1;
	for (const r of returns) growth *= 1 + r;
	return growth ** (TRADING_DAYS_PER_YEAR / returns.length) - 1;
}

/** Annualized volatility: sample stdev of daily returns x sqrt(252). */
export function annualizedVolatility(
	returns: readonly number[],
	minimumSamples: number,
): RiskValue | InsufficientSample {
	return (
		guard(returns.length, minimumSamples) ?? {
			status: "ok",
			value: sampleStdev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR),
		}
	);
}

/** Compound annualized return of the daily series: (prod(1+r))^(252/n) - 1. */
export function annualizedReturn(
	returns: readonly number[],
	minimumSamples: number,
): RiskValue | InsufficientSample {
	return guard(returns.length, minimumSamples) ?? { status: "ok", value: compoundAnnualized(returns) };
}

/** Sharpe ratio: (annualized return - riskFreeRate) / annualized volatility. */
export function sharpeRatio(
	returns: readonly number[],
	riskFreeRate: number,
	minimumSamples: number,
): RiskValue | InsufficientSample {
	const short = guard(returns.length, minimumSamples);
	if (short !== undefined) return short;
	const excess = compoundAnnualized(returns) - riskFreeRate;
	const vol = sampleStdev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
	if (vol === 0) {
		// Flat series: sign-preserving infinity rather than NaN so callers can rank.
		return { status: "ok", value: excess === 0 ? 0 : excess > 0 ? Infinity : -Infinity };
	}
	return { status: "ok", value: excess / vol };
}

/**
 * Sortino ratio: excess annualized return over annualized DOWNSIDE deviation.
 * Downside deviation uses the full sample count n (not just the count of
 * below-target days) against a daily target of riskFreeRate/252.
 */
export function sortinoRatio(
	returns: readonly number[],
	riskFreeRate: number,
	minimumSamples: number,
): RiskValue | InsufficientSample {
	const short = guard(returns.length, minimumSamples);
	if (short !== undefined) return short;
	const dailyTarget = riskFreeRate / TRADING_DAYS_PER_YEAR;
	let downsideSq = 0;
	for (const r of returns) {
		downsideSq += Math.min(r - dailyTarget, 0) ** 2;
	}
	const downsideDeviation =
		Math.sqrt(downsideSq / returns.length) * Math.sqrt(TRADING_DAYS_PER_YEAR);
	const excess = compoundAnnualized(returns) - riskFreeRate;
	if (downsideDeviation === 0) {
		return { status: "ok", value: excess === 0 ? 0 : excess > 0 ? Infinity : -Infinity };
	}
	return { status: "ok", value: excess / downsideDeviation };
}

/**
 * Maximum drawdown of the TWR-indexed (flow-adjusted) series built from the
 * dated daily returns, with peak and trough dates for the audit trail.
 */
export function maxDrawdown(
	returns: readonly DailyReturn[],
	minimumSamples: number,
): MaxDrawdownResult | InsufficientSample {
	const short = guard(returns.length, minimumSamples);
	if (short !== undefined) return short;
	let index = 1;
	let peak = Number.NEGATIVE_INFINITY;
	let peakDate = "";
	let worst = 0;
	let worstPeakDate = "";
	let worstTroughDate = "";
	for (const point of returns) {
		index *= 1 + point.value;
		if (index > peak) {
			peak = index;
			peakDate = point.date;
		}
		const drawdown = 1 - index / peak;
		if (drawdown > worst) {
			worst = drawdown;
			worstPeakDate = peakDate;
			worstTroughDate = point.date;
		}
	}
	if (worst === 0) {
		// Monotonic rise: no drawdown; peak == trough == the first point.
		const first = returns[0];
		const date = first === undefined ? "" : first.date;
		return { status: "ok", drawdown: 0, peakDate: date, troughDate: date };
	}
	return { status: "ok", drawdown: worst, peakDate: worstPeakDate, troughDate: worstTroughDate };
}
