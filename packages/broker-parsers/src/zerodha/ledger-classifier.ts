import type { CashFlowClassification, ChargeType } from "@connected-repo/zod-schemas/enums.zod";
import type { ZerodhaLedgerLine } from "./ledger.js";

/**
 * Rule engine mapping a Zerodha ledger line → Kosh cash-flow classification.
 *
 * `voucher_type` does most of the work (docs/research/broker-exports.md §2);
 * narration regexes add references for dedupe and symbol attribution. Rules
 * are ordered and FIRST-MATCH-WINS; anything unmatched comes back with
 * classification null + confidence "low" — the import pipeline turns those
 * into user prompts. NEVER add a catch-all guess: a wrongly classified flow
 * silently corrupts XIRR, an unclassified one just asks the user.
 */
export interface LedgerClassification {
	classification: CashFlowClassification | null;
	confidence: "high" | "low";
	chargeType?: ChargeType;
	/** Broker/bank reference ids captured from the narration, for dedupe. */
	reference?: string;
	/** Trading symbol named by the narration (e.g. DP charges). */
	symbol?: string;
	/** Which rule fired — versioned audit trail for the classification event. */
	rule: string;
}

interface Rule {
	name: string;
	voucherType: string;
	pattern: RegExp;
	classify: (m: RegExpMatchArray) => Omit<LedgerClassification, "rule">;
}

const REFERENCE_RE = /reference number\s+([a-z0-9]+)/i;

const RULES: Rule[] = [
	{
		name: "funds_added",
		voucherType: "Bank Receipts",
		pattern: /^Funds added/i,
		classify: () => ({ classification: "external_deposit", confidence: "high" }),
	},
	{
		name: "payout",
		voucherType: "Bank Payments",
		pattern: /^(?:Instant\s+)?Payout of/i,
		classify: (m) => ({
			classification: "external_withdrawal",
			confidence: "high",
			reference: m.input?.match(REFERENCE_RE)?.[1],
		}),
	},
	{
		// Broker-forced quarterly settlement: still real money leaving for the
		// user's bank account — an external withdrawal for return math.
		name: "quarterly_settlement",
		voucherType: "Bank Payments",
		pattern: /quarterly settlement/i,
		classify: (m) => ({
			classification: "external_withdrawal",
			confidence: "high",
			reference: m.input?.match(REFERENCE_RE)?.[1],
		}),
	},
	{
		name: "auto_settled",
		voucherType: "Bank Payments",
		pattern: /^Funds auto-settled/i,
		classify: () => ({ classification: "external_withdrawal", confidence: "high" }),
	},
	{
		// Cash leg of trades. Internal: the money moved against securities,
		// not in or out of the account — excluded from external flows.
		name: "net_settlement",
		voucherType: "Book Voucher",
		pattern: /^Net settlement for .*? settlement number:\s*(\S+)/i,
		classify: (m) => ({
			classification: "trade_settlement",
			confidence: "high",
			reference: m[1],
		}),
	},
	{
		name: "dp_charges",
		voucherType: "Journal Entry",
		pattern: /^DP Charges for Sale of\s+(\S+)/i,
		classify: (m) => ({
			classification: "charge",
			confidence: "high",
			chargeType: "dp_charge",
			symbol: m[1],
		}),
	},
	{
		name: "demat_amc",
		voucherType: "Journal Entry",
		pattern: /^AMC for Demat Account/i,
		classify: () => ({ classification: "charge", confidence: "high", chargeType: "amc" }),
	},
];

export function classifyZerodhaLedgerLine(line: ZerodhaLedgerLine): LedgerClassification {
	for (const rule of RULES) {
		if (line.voucherType !== rule.voucherType) continue;
		const m = line.particulars.match(rule.pattern);
		if (m) return { ...rule.classify(m), rule: rule.name };
	}
	return { classification: null, confidence: "low", rule: "unmatched" };
}
