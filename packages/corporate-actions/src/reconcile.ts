// The detection net: expected holdings (from replay) vs broker-reported holdings. Feeds are
// an optimization — reconciliation is the guarantee that catches any action they missed.

import { formatDecimal8, parseDecimal8 } from "./decimal8";
import type { Position } from "./types";

export type ReportedHolding = {
	isin: string;
	/** Decimal string */
	quantity: string;
};

export type Discrepancy = {
	isin: string;
	expectedQty: string;
	reportedQty: string;
	/** reported − expected: positive means the broker holds more than the ledger explains */
	diff: string;
};

/**
 * Compare over the union of ISINs on either side (a holding present on only one side counts
 * as zero on the other). Returns only rows where the quantities disagree, sorted by ISIN —
 * each row is an "unexplained holding" prompt candidate.
 */
export function reconcileHoldings(
	expected: Position[],
	reported: ReportedHolding[],
): Discrepancy[] {
	const expectedByIsin = new Map<string, bigint>();
	for (const position of expected) {
		expectedByIsin.set(
			position.isin,
			(expectedByIsin.get(position.isin) ?? 0n) + parseDecimal8(position.quantity),
		);
	}
	const reportedByIsin = new Map<string, bigint>();
	for (const holding of reported) {
		reportedByIsin.set(
			holding.isin,
			(reportedByIsin.get(holding.isin) ?? 0n) + parseDecimal8(holding.quantity),
		);
	}

	const isins = [...new Set([...expectedByIsin.keys(), ...reportedByIsin.keys()])].sort();
	const discrepancies: Discrepancy[] = [];
	for (const isin of isins) {
		const expectedQty = expectedByIsin.get(isin) ?? 0n;
		const reportedQty = reportedByIsin.get(isin) ?? 0n;
		if (expectedQty === reportedQty) continue;
		discrepancies.push({
			isin,
			expectedQty: formatDecimal8(expectedQty),
			reportedQty: formatDecimal8(reportedQty),
			diff: formatDecimal8(reportedQty - expectedQty),
		});
	}
	return discrepancies;
}
