import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseZerodhaLedger } from "./ledger.js";
import { classifyZerodhaLedgerLine } from "./ledger-classifier.js";
import { validateZerodhaLedgerBalances } from "./ledger-validator.js";

const FIXTURE = readFileSync(new URL("./__fixtures__/ledger.csv", import.meta.url), "utf8");

describe("parseZerodhaLedger", () => {
	it("parses rows and balance anchors", () => {
		const res = parseZerodhaLedger(FIXTURE);
		expect(res.errors).toEqual([]);
		expect(res.rows).toHaveLength(10);
		expect(res.meta.openingBalance).toBe("0.000000");
		expect(res.meta.closingBalance).toBe("0.000000");
		expect(res.meta.postingDateSpan).toEqual({ from: "2025-09-01", to: "2025-12-28" });
		expect(res.meta.voucherTypes.sort()).toEqual([
			"Bank Payments",
			"Bank Receipts",
			"Book Voucher",
			"Journal Entry",
		]);
	});

	it("handles quoted narrations containing commas", () => {
		const res = parseZerodhaLedger(FIXTURE);
		const payout = res.rows.find((r) => r.particulars.startsWith("Instant Payout"));
		expect(payout?.particulars).toContain("DEMO BANK LTD, 0000111122");
	});
});

describe("classifyZerodhaLedgerLine", () => {
	const rows = parseZerodhaLedger(FIXTURE).rows;
	const byStart = (prefix: string) => {
		const row = rows.find((r) => r.particulars.startsWith(prefix));
		if (!row) throw new Error(`No fixture row starting with ${prefix}`);
		return classifyZerodhaLedgerLine(row);
	};

	it("classifies deposits", () => {
		expect(byStart("Funds added using UPI")).toMatchObject({
			classification: "external_deposit",
			confidence: "high",
			rule: "funds_added",
		});
	});

	it("classifies payouts with reference extraction", () => {
		expect(byStart("Instant Payout")).toMatchObject({
			classification: "external_withdrawal",
			confidence: "high",
			reference: "abc123def4",
			rule: "payout",
		});
	});

	it("classifies quarterly settlement returns as withdrawals", () => {
		expect(byStart("Funds transferred back")).toMatchObject({
			classification: "external_withdrawal",
			reference: "4927f683ab",
			rule: "quarterly_settlement",
		});
		expect(byStart("Funds auto-settled")).toMatchObject({
			classification: "external_withdrawal",
			rule: "auto_settled",
		});
	});

	it("classifies trade settlements as internal with settlement number", () => {
		expect(byStart("Net settlement")).toMatchObject({
			classification: "trade_settlement",
			reference: "2025100",
		});
	});

	it("classifies charges with type and symbol attribution", () => {
		expect(byStart("DP Charges")).toMatchObject({
			classification: "charge",
			chargeType: "dp_charge",
			symbol: "ALPHAX",
		});
		expect(byStart("AMC for Demat")).toMatchObject({
			classification: "charge",
			chargeType: "amc",
		});
	});

	it("refuses to guess on unknown narrations", () => {
		expect(byStart("Reversal of payment gateway")).toEqual({
			classification: null,
			confidence: "low",
			rule: "unmatched",
		});
	});
});

describe("validateZerodhaLedgerBalances", () => {
	it("reproduces the running balance exactly on the fixture", () => {
		const res = parseZerodhaLedger(FIXTURE);
		const v = validateZerodhaLedgerBalances(res.rows, res.meta);
		expect(v.errors).toEqual([]);
		expect(v.ok).toBe(true);
		expect(v.warnings).toEqual([]);
	});

	it("fails the whole file on a single tampered balance", () => {
		const tampered = FIXTURE.replace("49985.310000", "49985.310001");
		const res = parseZerodhaLedger(tampered);
		const v = validateZerodhaLedgerBalances(res.rows, res.meta);
		expect(v.ok).toBe(false);
		expect(v.errors[0]?.code).toBe("balance_mismatch");
		expect(v.errors[0]?.message).toContain("DP Charges");
	});

	it("fails on a missing (deleted) row — the gap shows up as a mismatch", () => {
		const withoutDeposit = FIXTURE.split("\n")
			.filter((l) => !l.startsWith("Funds added using NEFT"))
			.join("\n");
		const res = parseZerodhaLedger(withoutDeposit);
		const v = validateZerodhaLedgerBalances(res.rows, res.meta);
		expect(v.ok).toBe(false);
	});

	it("requires the opening anchor", () => {
		const noOpening = FIXTURE.split("\n")
			.filter((l) => !l.startsWith("Opening Balance"))
			.join("\n");
		const res = parseZerodhaLedger(noOpening);
		const v = validateZerodhaLedgerBalances(res.rows, res.meta);
		expect(v.ok).toBe(false);
		expect(v.errors[0]?.message).toContain("Opening Balance");
	});

	it("warns (not fails) on non-monotonic posting dates", () => {
		// Swap two data lines to break date order while keeping balances a
		// prefix-consistent chain is impossible — so build a tiny 2-row file.
		const tiny = [
			"particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance",
			"Opening Balance,,,,,,0.000000",
			"Funds added using UPI,2025-09-02,NSE-EQ - Z,Bank Receipts,0.000000,10.000000,10.000000",
			"Funds added using UPI,2025-09-01,NSE-EQ - Z,Bank Receipts,0.000000,5.000000,15.000000",
			"Closing Balance,,,,,,15.000000",
		].join("\n");
		const res = parseZerodhaLedger(tiny);
		const v = validateZerodhaLedgerBalances(res.rows, res.meta);
		expect(v.ok).toBe(true);
		expect(v.warnings).toHaveLength(1);
	});
});
