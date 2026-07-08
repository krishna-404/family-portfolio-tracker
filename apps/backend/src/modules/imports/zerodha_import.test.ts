import { db } from "@backend/db/db";
import {
	type RequestContext,
	requestContext,
} from "@backend/lib/request-context";
import {
	applyImport,
	type ImportInput,
	listBatches,
	prepareImport,
	retractBatch,
} from "@backend/modules/imports/services/zerodha_import.service";
import { defaultContext } from "@backend/test/setup";
import { beforeEach, describe, expect, it } from "vitest";

// ── Fixtures (anonymized; structure mirrors real Zerodha Console exports) ──

const TRADEBOOK = [
	"symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
	"ALPHAX,INE001A01011,2025-09-05,NSE,EQ,EQ,buy,false,10.000000,100.000000,TB1,OB1,2025-09-05T10:00:00",
	"BETAX,INE002B01010,2025-09-06,BSE,EQ,A,buy,false,5.000000,200.000000,TB2,OB2,2025-09-06T11:00:00",
	// Blank ISIN (fresh listing) → raw-only, counted for a mapping prompt.
	"NEWLIST,,2025-09-07,BSE,EQ,B,buy,false,50.000000,10.000000,TB3,OB3,2025-09-07T12:00:00",
].join("\n");

const LEDGER = [
	"particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance",
	"Opening Balance,,,,,,0.000000",
	"Funds added using UPI ref1,2025-09-01,NSE-EQ - Z,Bank Receipts,0.000000,10000.000000,10000.000000",
	"DP Charges for Sale of ALPHAX on 05/09/2025,2025-09-05,NSE-EQ - Z,Journal Entry,15.340000,0.000000,9984.660000",
	"Reversal of something unusual,2025-09-06,NSE-EQ - Z,Journal Entry,0.000000,1.000000,9985.660000",
	"Closing Balance,,,,,,9985.660000",
].join("\n");

// ── Harness: run a service inside the family's request context ──

async function runAsFamily<T>(fn: () => Promise<T>): Promise<T> {
	if (!defaultContext) throw new Error("defaultContext not initialized");
	const teamId = defaultContext.user.activeTeamAppId;
	if (!teamId) throw new Error("user has no active team");
	const member = await db.teamMembers
		.where({ teamId, userId: defaultContext.user.id })
		.take();
	const ctx: RequestContext = {
		tenantTeamId: teamId,
		userId: defaultContext.user.id,
		teamMemberId: member.id,
		teamMemberRole: member.role,
	};
	return requestContext.run(ctx, fn);
}

async function seedAccount(): Promise<string> {
	return runAsFamily(async () => {
		const person = await db.persons.create({ displayName: "Test Person" });
		const account = await db.brokerAccounts.create({
			personId: person.id,
			broker: "zerodha",
			label: "Zerodha EQ",
		});
		return account.id;
	});
}

function tradebookInput(accountId: string, content = TRADEBOOK): ImportInput {
	return { accountId, kind: "tradebook", fileName: "tradebook.csv", content };
}
function ledgerInput(accountId: string, content = LEDGER): ImportInput {
	return { accountId, kind: "ledger", fileName: "ledger.csv", content };
}

describe("Zerodha tradebook import", () => {
	let accountId: string;
	beforeEach(async () => {
		accountId = await seedAccount();
	});

	it("previews all rows as new and counts blank-ISIN for mapping", async () => {
		const preview = await runAsFamily(() =>
			prepareImport(tradebookInput(accountId)),
		);
		expect(preview.canApply).toBe(true);
		expect(preview.summary).toMatchObject({
			total: 3,
			new: 3,
			duplicate: 0,
			error: 0,
		});
		expect(preview.summary.needsInstrumentMapping).toBe(1);
		expect(preview.rows.every((r) => r.status === "new")).toBe(true);
	});

	it("applies raw trades, recognizes resolvable ones, creates instruments", async () => {
		const res = await runAsFamily(() => applyImport(tradebookInput(accountId)));
		await runAsFamily(async () => {
			expect(await db.rawTrades.where({ accountId }).count()).toBe(3);
			// Only the two ISIN-bearing rows become recognized trades.
			expect(await db.trades.where({ accountId }).count()).toBe(2);
			expect(res.summary.recognized).toBe(2);
			expect(
				await db.instruments
					.whereIn("isin", ["INE001A01011", "INE002B01010"])
					.count(),
			).toBe(2);
			expect(await db.events.where({ kind: "trade_recognized" }).count()).toBe(
				2,
			);
			// grossValue = qty × price, money(2dp).
			const rawAlpha = await db.rawTrades
				.where({ accountId, brokerTradeId: "TB1" })
				.take();
			const alpha = await db.trades.where({ rawTradeId: rawAlpha.id }).take();
			expect(alpha.grossValue).toBe("1000.00");
		});
	});

	it("re-detects an identical re-upload as fully duplicate", async () => {
		await runAsFamily(() => applyImport(tradebookInput(accountId)));
		const preview = await runAsFamily(() =>
			prepareImport(tradebookInput(accountId)),
		);
		expect(preview.summary).toMatchObject({ new: 0, duplicate: 3 });
		const res = await runAsFamily(() => applyImport(tradebookInput(accountId)));
		expect(res.summary.recognized).toBe(0);
		await runAsFamily(async () => {
			expect(
				await db.rawTrades.where({ accountId, isLive: true }).count(),
			).toBe(3);
		});
	});
});

describe("Zerodha ledger import", () => {
	let accountId: string;
	beforeEach(async () => {
		accountId = await seedAccount();
	});

	it("classifies high-confidence lines into cash flows, leaves the rest raw", async () => {
		const res = await runAsFamily(() => applyImport(ledgerInput(accountId)));
		expect(res.summary.unclassified).toBe(1);
		await runAsFamily(async () => {
			expect(await db.rawLedgerLines.where({ accountId }).count()).toBe(3);
			expect(await db.cashFlows.where({ accountId }).count()).toBe(2);
			const deposit = await db.cashFlows
				.where({ classification: "external_deposit" })
				.take();
			expect(deposit.amount).toBe("10000.00");
			const charge = await db.cashFlows
				.where({ classification: "charge" })
				.take();
			expect(charge.amount).toBe("-15.34");
		});
	});

	it("rejects the whole file when the balance chain does not reproduce", async () => {
		const tampered = LEDGER.replace("9984.660000", "9984.660001");
		const preview = await runAsFamily(() =>
			prepareImport(ledgerInput(accountId, tampered)),
		);
		expect(preview.canApply).toBe(false);
		expect(preview.errors.some((e) => e.code === "balance_mismatch")).toBe(
			true,
		);
		await expect(
			runAsFamily(() => applyImport(ledgerInput(accountId, tampered))),
		).rejects.toThrow();
	});
});

describe("Batch retraction", () => {
	let accountId: string;
	beforeEach(async () => {
		accountId = await seedAccount();
	});

	it("supersedes events, marks rows non-live, and frees the file for re-import", async () => {
		const applied = await runAsFamily(() =>
			applyImport(tradebookInput(accountId)),
		);
		await runAsFamily(() =>
			retractBatch({ batchId: applied.batchId, reason: "wrong account" }),
		);

		await runAsFamily(async () => {
			const batch = await db.importBatches.find(applied.batchId);
			expect(batch.status).toBe("retracted");
			expect(batch.retractionEventId).not.toBeNull();
			// Every event the batch produced is now superseded.
			const live = await db.events
				.where({ kind: "trade_recognized", supersededByEventId: null })
				.count();
			expect(live).toBe(0);
			// Raw rows persist but are non-live.
			expect(await db.rawTrades.where({ accountId }).count()).toBe(3);
			expect(
				await db.rawTrades.where({ accountId, isLive: true }).count(),
			).toBe(0);
		});

		// The same file is importable again after retraction.
		const preview = await runAsFamily(() =>
			prepareImport(tradebookInput(accountId)),
		);
		expect(preview.summary).toMatchObject({ new: 3, duplicate: 0 });
		const reapplied = await runAsFamily(() =>
			applyImport(tradebookInput(accountId)),
		);
		expect(reapplied.summary.recognized).toBe(2);
		await runAsFamily(async () => {
			const batches = await listBatches(accountId);
			expect(batches).toHaveLength(2);
		});
	});

	it("requires a non-empty reason", async () => {
		const applied = await runAsFamily(() =>
			applyImport(tradebookInput(accountId)),
		);
		await expect(
			runAsFamily(() =>
				retractBatch({ batchId: applied.batchId, reason: "  " }),
			),
		).rejects.toThrow();
	});
});
