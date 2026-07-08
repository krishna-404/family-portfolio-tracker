import { db } from "@backend/db/db";
import { getRequestContext } from "@backend/lib/request-context";
import { parseZerodhaLedger } from "@connected-repo/broker-parsers/zerodha/ledger";
import { classifyZerodhaLedgerLine } from "@connected-repo/broker-parsers/zerodha/ledger-classifier";
import { validateZerodhaLedgerBalances } from "@connected-repo/broker-parsers/zerodha/ledger-validator";
import {
	parseZerodhaTradebook,
	type ZerodhaTrade,
} from "@connected-repo/broker-parsers/zerodha/tradebook";
import type { CashFlowClassification } from "@connected-repo/zod-schemas/enums.zod";
import { ORPCError } from "@orpc/server";
import { mulToMoney, signedFlowAmount } from "../lib/decimal.imports";
import { ledgerLineHash, sha256Hex } from "../lib/hash.imports";

export type ImportKind = "tradebook" | "ledger";

export interface ImportInput {
	accountId: string;
	kind: ImportKind;
	fileName: string;
	/** Raw CSV text. (Binary/XLSX verbatim storage is a later phase.) */
	content: string;
}

export interface PreviewRow {
	/** brokerTradeId (tradebook) or 1-based ledger row number. */
	ref: string;
	status: "new" | "duplicate";
}

export interface ImportPreview {
	kind: ImportKind;
	fileName: string;
	contentSha256: string;
	/** True only when the whole file can be applied atomically (no row errors,
	 *  and — for ledgers — the balance-reproduction gate passed). */
	canApply: boolean;
	summary: Record<string, number>;
	errors: { row: number; code: string; message: string }[];
	rows: PreviewRow[];
	/** File-level facts (date spans, balances, classification counts). */
	meta: Record<string, unknown>;
}

export interface ApplyResult {
	batchId: string;
	summary: Record<string, number>;
}

// ─── Analysis (shared by preview + apply) ───────────────────────────────

interface TradebookAnalysis {
	kind: "tradebook";
	trades: ZerodhaTrade[];
	dupTradeIds: Set<string>;
	preview: ImportPreview;
}

async function analyzeTradebook(
	input: ImportInput,
	contentSha256: string,
): Promise<TradebookAnalysis> {
	const parsed = parseZerodhaTradebook(input.content);
	const errors = parsed.errors.map((e) => ({
		row: e.row,
		code: e.code,
		message: e.message,
	}));

	// Duplicate detection against LIVE raw_trades for this account.
	const ids = parsed.rows.map((r) => r.brokerTradeId);
	const existing =
		ids.length > 0
			? await db.rawTrades
					.where({
						accountId: input.accountId,
						isLive: true,
						brokerTradeId: { in: ids },
					})
					.pluck("brokerTradeId")
			: [];
	const dupTradeIds = new Set(existing.filter((v): v is string => v !== null));

	const rows: PreviewRow[] = parsed.rows.map((r) => ({
		ref: r.brokerTradeId,
		status: dupTradeIds.has(r.brokerTradeId) ? "duplicate" : "new",
	}));
	const newCount = rows.filter((r) => r.status === "new").length;
	const needsMapping = parsed.rows.filter((r) => r.isin === null).length;
	const canApply = errors.length === 0;

	return {
		kind: "tradebook",
		trades: parsed.rows,
		dupTradeIds,
		preview: {
			kind: "tradebook",
			fileName: input.fileName,
			contentSha256,
			canApply,
			summary: {
				total: parsed.rows.length + errors.length,
				new: newCount,
				duplicate: rows.length - newCount,
				error: errors.length,
				needsInstrumentMapping: needsMapping,
			},
			errors,
			rows,
			meta: {
				tradeDateSpan: parsed.meta.tradeDateSpan,
				segments: parsed.meta.segments,
			},
		},
	};
}

interface LedgerAnalysis {
	kind: "ledger";
	// Rows paired with their classification + dedupe hash, in file order.
	entries: {
		line: ReturnType<typeof parseZerodhaLedger>["rows"][number];
		hash: string;
		classification: CashFlowClassification | null;
		rule: string;
		duplicate: boolean;
	}[];
	preview: ImportPreview;
}

async function analyzeLedger(
	input: ImportInput,
	contentSha256: string,
): Promise<LedgerAnalysis> {
	const parsed = parseZerodhaLedger(input.content);
	const errors = parsed.errors.map((e) => ({
		row: e.row,
		code: e.code,
		message: e.message,
	}));

	// Plausibility gate: exact balance reproduction. A failure rejects the file.
	const balance = validateZerodhaLedgerBalances(parsed.rows, parsed.meta);
	for (const e of balance.errors)
		errors.push({ row: e.row, code: e.code, message: e.message });

	// Duplicate detection against LIVE raw_ledger_lines for this account, by
	// content hash (Zerodha ledgers carry no stable per-line id).
	const existingLines = await db.rawLedgerLines
		.where({ accountId: input.accountId, isLive: true })
		.select("postedDate", "narration", "debit", "credit");
	const seen = new Set(
		existingLines.map((l) =>
			ledgerLineHash({
				accountId: input.accountId,
				postedDate: l.postedDate,
				narration: l.narration,
				debit: l.debit,
				credit: l.credit,
			}),
		),
	);

	const classCounts: Record<string, number> = {};
	let unclassified = 0;
	const entries = parsed.rows.map((line) => {
		const hash = ledgerLineHash({
			accountId: input.accountId,
			postedDate: line.postingDate,
			narration: line.particulars,
			debit: line.debit,
			credit: line.credit,
		});
		const c = classifyZerodhaLedgerLine(line);
		const classification = c.confidence === "high" ? c.classification : null;
		if (classification)
			classCounts[classification] = (classCounts[classification] ?? 0) + 1;
		else unclassified++;
		return {
			line,
			hash,
			classification,
			rule: c.rule,
			duplicate: seen.has(hash),
		};
	});

	const rows: PreviewRow[] = entries.map((e) => ({
		ref: String(e.line.row),
		status: e.duplicate ? "duplicate" : "new",
	}));
	const newCount = rows.filter((r) => r.status === "new").length;

	return {
		kind: "ledger",
		entries,
		preview: {
			kind: "ledger",
			fileName: input.fileName,
			contentSha256,
			canApply: errors.length === 0,
			summary: {
				total: parsed.rows.length + parsed.errors.length,
				new: newCount,
				duplicate: rows.length - newCount,
				error: errors.length,
				unclassified,
			},
			errors,
			rows,
			meta: {
				postingDateSpan: parsed.meta.postingDateSpan,
				openingBalance: parsed.meta.openingBalance,
				closingBalance: parsed.meta.closingBalance,
				balanceOk: balance.ok,
				classificationCounts: classCounts,
			},
		},
	};
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Dry run: parse + gate + dedupe, return a preview. Mutates nothing. */
export async function prepareImport(
	input: ImportInput,
): Promise<ImportPreview> {
	await db.brokerAccounts.find(input.accountId); // tenant-scoped authorization
	const sha = sha256Hex(input.content);
	const analysis =
		input.kind === "tradebook"
			? await analyzeTradebook(input, sha)
			: await analyzeLedger(input, sha);
	return analysis.preview;
}

function requireCtx(): { familyId: string; userId: string } {
	const ctx = getRequestContext();
	if (!ctx)
		throw new ORPCError("UNAUTHORIZED", {
			status: 401,
			message: "No active session",
		});
	return { familyId: ctx.tenantTeamId, userId: ctx.userId };
}

function toEpoch(date: string): number {
	return Date.parse(`${date}T00:00:00Z`);
}

/** Get-or-create the global instrument for an ISIN, plus a broker-symbol alias. */
async function resolveInstrument(
	isin: string,
	symbol: string,
	exchange: string,
): Promise<string> {
	const existing = await db.instruments.findByOptional({ isin });
	const instrumentId =
		existing?.id ??
		(
			await db.instruments.create({
				kind: "equity",
				isin,
				symbolCanonical: symbol,
				name: symbol,
				currency: "INR",
				exchangeCalendar:
					exchange === "NSE" || exchange === "BSE" ? exchange : null,
			})
		).id;

	const alias = await db.instrumentAliases
		.where({
			instrumentId,
			aliasKind: "broker_symbol",
			alias: symbol,
			broker: "zerodha",
		})
		.takeOptional();
	if (!alias) {
		await db.instrumentAliases.create({
			instrumentId,
			aliasKind: "broker_symbol",
			alias: symbol,
			broker: "zerodha",
		});
	}
	return instrumentId;
}

/** Apply a file atomically: raw rows + Layer-2 recognition in one transaction. */
export async function applyImport(input: ImportInput): Promise<ApplyResult> {
	await db.brokerAccounts.find(input.accountId);
	const { userId } = requireCtx();
	const sha = sha256Hex(input.content);

	if (input.kind === "tradebook") {
		const { trades, dupTradeIds, preview } = await analyzeTradebook(input, sha);
		if (!preview.canApply) {
			throw new ORPCError("BAD_REQUEST", {
				status: 400,
				message: "File has errors; cannot apply",
			});
		}
		return db.$transaction(async () => {
			const batch = await db.importBatches.create({
				accountId: input.accountId,
				kind: "tradebook",
				status: "applied",
				contentSha256: sha,
				uploadedByUserId: userId,
				appliedAt: Date.now(),
				stats: preview.summary,
			});
			let recognized = 0;
			for (const t of trades) {
				if (dupTradeIds.has(t.brokerTradeId)) continue;
				const raw = await db.rawTrades.create({
					batchId: batch.id,
					accountId: input.accountId,
					tradeDate: t.tradeDate,
					execTime: t.executedAt ? Date.parse(`${t.executedAt}Z`) : null,
					brokerSymbol: t.symbol,
					exchange: t.exchange,
					isin: t.isin,
					side: t.side,
					quantity: t.quantity,
					price: t.price,
					brokerTradeId: t.brokerTradeId,
					brokerOrderId: t.brokerOrderId,
					charges: null,
					rawRow: { ...t },
				});
				// NULL-ISIN rows stay raw-only until an instrument-mapping prompt
				// resolves them (counted in stats.needsInstrumentMapping).
				if (t.isin === null) continue;
				const instrumentId = await resolveInstrument(
					t.isin,
					t.symbol,
					t.exchange,
				);
				const event = await db.events.create({
					kind: "trade_recognized",
					payload: { batchId: batch.id, rawTradeId: raw.id },
					actor: "system",
					occurredAt: toEpoch(t.tradeDate),
				});
				const gross = mulToMoney(t.quantity, t.price);
				await db.trades.create({
					rawTradeId: raw.id,
					accountId: input.accountId,
					instrumentId,
					tradeDate: t.tradeDate,
					side: t.side,
					quantity: t.quantity,
					price: t.price,
					grossValue: gross,
					totalCharges: "0.00", // TODO(kosh): attach charges from ledger
					netValue: gross,
					recognizedEventId: event.id,
				});
				recognized++;
			}
			return { batchId: batch.id, summary: { ...preview.summary, recognized } };
		});
	}

	const { entries, preview } = await analyzeLedger(input, sha);
	if (!preview.canApply) {
		throw new ORPCError("BAD_REQUEST", {
			status: 400,
			message: "File has errors; cannot apply",
		});
	}
	return db.$transaction(async () => {
		const batch = await db.importBatches.create({
			accountId: input.accountId,
			kind: "ledger",
			status: "applied",
			contentSha256: sha,
			uploadedByUserId: userId,
			appliedAt: Date.now(),
			stats: preview.summary,
		});
		let classified = 0;
		for (const e of entries) {
			if (e.duplicate) continue;
			const raw = await db.rawLedgerLines.create({
				batchId: batch.id,
				accountId: input.accountId,
				postedDate: e.line.postingDate,
				valueDate: null,
				narration: e.line.particulars,
				debit: e.line.debit,
				credit: e.line.credit,
				runningBalance: e.line.netBalance,
				brokerVoucherId: null,
				rawRow: { ...e.line },
			});
			if (!e.classification) continue; // low-confidence → raw only (prompt later)
			const event = await db.events.create({
				kind: "cash_flow_classified",
				payload: { batchId: batch.id, rawLedgerLineId: raw.id, rule: e.rule },
				actor: "system",
				occurredAt: toEpoch(e.line.postingDate),
			});
			const amount = signedFlowAmount(e.line.debit, e.line.credit);
			await db.cashFlows.create({
				accountId: input.accountId,
				flowDate: e.line.postingDate,
				amount,
				currency: "INR",
				classification: e.classification,
				sourceLedgerLineId: raw.id,
				classifiedEventId: event.id,
				inrAmount: amount,
			});
			classified++;
		}
		return { batchId: batch.id, summary: { ...preview.summary, classified } };
	});
}

/**
 * Retract a batch as a unit: a superseding retraction event, batch marked
 * retracted, every event the batch produced stamped superseded, and every
 * raw row marked non-live so its dedupe key frees for re-import. Deletes
 * nothing (owner directive: retraction is an event, never a destructive edit).
 */
export async function retractBatch(input: {
	batchId: string;
	reason: string;
}): Promise<void> {
	const { userId } = requireCtx();
	if (!input.reason.trim()) {
		throw new ORPCError("BAD_REQUEST", {
			status: 400,
			message: "Retraction reason is required",
		});
	}
	const batch = await db.importBatches.find(input.batchId); // tenant-scoped
	if (batch.status === "retracted") {
		throw new ORPCError("BAD_REQUEST", {
			status: 400,
			message: "Batch already retracted",
		});
	}
	await db.$transaction(async () => {
		const retraction = await db.events.create({
			kind: "retraction",
			payload: { batchId: batch.id },
			actor: "user",
			userId,
			occurredAt: Date.now(),
			reason: input.reason,
		});
		// Supersede every event this batch produced (its payloads carry batchId).
		await db.events.where({
			kind: { in: ["trade_recognized", "cash_flow_classified"] },
		}).whereSql`payload->>'batchId' = ${batch.id}`.update({
			supersededByEventId: retraction.id,
		});
		await db.rawTrades.where({ batchId: batch.id }).update({ isLive: false });
		await db.rawLedgerLines
			.where({ batchId: batch.id })
			.update({ isLive: false });
		await db.importBatches
			.where({ id: batch.id })
			.update({ status: "retracted", retractionEventId: retraction.id });
	});
}

export async function listBatches(accountId: string) {
	return db.importBatches
		.where({ accountId })
		.order({ createdAt: "DESC" })
		.select(
			"id",
			"kind",
			"status",
			"contentSha256",
			"appliedAt",
			"stats",
			"createdAt",
		);
}
