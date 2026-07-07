import { daysBetween } from "./flows.js";

const DAYS_IN_YEAR = 365;

/**
 * One valuation point of the series feeding TWR. `value` is the end-of-day
 * valuation; `inflow`/`outflow` are the external flows (spec §1) dated to
 * that day, both as non-negative magnitudes.
 */
export type ValuationPoint = {
	/** YYYY-MM-DD */
	date: string;
	value: number;
	inflow: number;
	outflow: number;
};

export type DailyReturn = {
	/** YYYY-MM-DD — the day the return accrued (period ending this date). */
	date: string;
	value: number;
};

export type TwrResult = {
	/** Geometrically linked return over the whole window. */
	cumulative: number;
	/** (1 + cumulative)^(365/days) - 1 */
	annualized: number;
	/** Calendar days between first and last valuation. */
	days: number;
	/** Per-period returns, for risk metrics downstream. */
	dailyReturns: DailyReturn[];
	/** Dates whose denominator (V_prev + inflow) was zero — return forced to 0. */
	zeroDenominatorDays: string[];
};

/**
 * Daily-linked time-weighted return over an ascending valuation series.
 *
 * Per-period return follows the Portfolio Performance convention — inflows
 * are treated as arriving at the start of the day (denominator), outflows as
 * leaving at the end (numerator):
 *
 *   r_t = (V_t + out_t) / (V_{t-1} + in_t) - 1
 *
 * Deposit/withdrawal timing therefore cancels out of TWR (manager skill),
 * unlike XIRR (investor outcome). Zero-denominator days (account empty)
 * contribute r = 0 and are flagged in `zeroDenominatorDays`.
 */
export function twr(series: readonly ValuationPoint[]): TwrResult {
	if (series.length < 2) {
		throw new Error(`twr requires at least 2 valuation points, got ${series.length}`);
	}
	const sorted = [...series].sort((a, b) => daysBetween(b.date, a.date));
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (prev !== undefined && cur !== undefined && prev.date === cur.date) {
			throw new Error(`Duplicate valuation date: ${cur.date}`);
		}
	}

	const dailyReturns: DailyReturn[] = [];
	const zeroDenominatorDays: string[] = [];
	let growth = 1;
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (prev === undefined || cur === undefined) continue;
		const denominator = prev.value + cur.inflow;
		let r = 0;
		if (denominator === 0) {
			zeroDenominatorDays.push(cur.date);
		} else {
			r = (cur.value + cur.outflow) / denominator - 1;
		}
		dailyReturns.push({ date: cur.date, value: r });
		growth *= 1 + r;
	}

	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	if (first === undefined || last === undefined) {
		throw new Error("unreachable: series validated non-empty");
	}
	const days = daysBetween(first.date, last.date);
	const cumulative = growth - 1;
	return {
		cumulative,
		annualized: (1 + cumulative) ** (DAYS_IN_YEAR / days) - 1,
		days,
		dailyReturns,
		zeroDenominatorDays,
	};
}
