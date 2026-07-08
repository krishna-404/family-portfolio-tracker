import { daysBetween, type Flow } from "./flows.js";

const DAYS_IN_YEAR = 365;

export type ModifiedDietzInput = {
	/** YYYY-MM-DD window bounds; endDate must be after startDate. */
	startDate: string;
	endDate: string;
	/** Valuation at startDate / endDate. */
	startValue: number;
	endValue: number;
	/**
	 * External flows inside the window, in the investor's-pocket convention
	 * of `Flow` (deposit < 0, withdrawal > 0). Converted internally to the
	 * portfolio perspective Dietz needs.
	 */
	flows: readonly Flow[];
};

export type ModifiedDietzResult = {
	returnRate: number;
	/** (1 + returnRate)^(365/days) - 1 */
	annualized: number;
	days: number;
	/** Denominator: startValue + time-weighted net flows (portfolio perspective). */
	averageCapital: number;
	/** Net external flow, portfolio perspective (deposits positive). */
	netExternalFlow: number;
};

/**
 * Modified Dietz return over a period — the DOCUMENTED FALLBACK for windows
 * where daily valuations have gaps and true daily-linked TWR (twr.ts) cannot
 * be computed (spec §3). It approximates TWR by day-weighting each external
 * flow: weight_i = (totalDays - daysSinceStart_i) / totalDays.
 */
export function modifiedDietz(input: ModifiedDietzInput): ModifiedDietzResult {
	const days = daysBetween(input.startDate, input.endDate);
	if (days <= 0) {
		throw new Error(`endDate must be after startDate (${input.startDate} .. ${input.endDate})`);
	}
	let netExternalFlow = 0;
	let weightedFlows = 0;
	for (const flow of input.flows) {
		const sinceStart = daysBetween(input.startDate, flow.date);
		if (sinceStart < 0 || sinceStart > days) {
			throw new Error(`Flow on ${flow.date} is outside the window ${input.startDate}..${input.endDate}`);
		}
		// Flip investor-pocket sign to portfolio perspective: deposits add capital.
		const cf = -flow.amount;
		netExternalFlow += cf;
		weightedFlows += cf * ((days - sinceStart) / days);
	}
	const averageCapital = input.startValue + weightedFlows;
	if (averageCapital === 0) {
		throw new Error("Modified Dietz undefined: average capital is zero");
	}
	const gain = input.endValue - input.startValue - netExternalFlow;
	const returnRate = gain / averageCapital;
	return {
		returnRate,
		annualized: (1 + returnRate) ** (DAYS_IN_YEAR / days) - 1,
		days,
		averageCapital,
		netExternalFlow,
	};
}
