import { db } from "@backend/db/db";
import type { FileSelectAll } from "@connected-repo/zod-schemas/file.zod";
import type {
	JournalEntryCreateInputWithRelations,
	JournalEntryPushCreatesInput,
	JournalEntryPushCreatesOutput,
	JournalEntryPushCreatesResult,
	JournalEntrySelectAllWithRelations,
} from "@connected-repo/zod-schemas/journal-entries/sync";

/**
 * Push a batch of offline-created journal entries (each with its optional
 * nested `files: FileCreateInput[]`).
 *
 * Fast path — one bulk `createMany` with nested `files: { create }` and
 * `onConflictDoNothing("id")`. The nested create is atomic on its own
 * (single ORM call — verify emitted SQL if pushing high volume).
 *
 * Slow path — invoked only if the bulk path throws (a NOT NULL / FK /
 * check-constraint failure on some row rolled the whole batch back).
 * Iterates per row so bad rows land as `{ok:false, id, error}` without
 * taking the whole batch down.
 *
 * Idempotency — ULID `id` on parent AND every child file.
 * `onConflictDoNothing("id")` silently skips existing rows on retry. The
 * canonical-row fetch at the end guarantees the response carries the
 * server-owned `updatedAt` for every id (including retries).
 */
export async function pushJournalEntryCreatesService(
	input: JournalEntryPushCreatesInput,
	authorUserId: string,
): Promise<JournalEntryPushCreatesOutput> {
	if (input.creates.length === 0) return { results: [] };

	try {
		const bulkResults = await tryBulkInsert(input.creates, authorUserId);
		return { results: bulkResults };
	} catch (bulkErr) {
		// biome-ignore lint/suspicious/noConsole: intentional operational trail — the fast path is a hot codepath, and knowing it failed tells us to inspect the batch shape
		console.warn(
			"[journalEntries.pushCreates] bulk path failed; falling back to sequential per-row",
			bulkErr,
		);
	}

	const results: JournalEntryPushCreatesResult[] = [];
	for (const c of input.creates) {
		try {
			const row = await insertOne(c, authorUserId);
			results.push({ ok: true, id: c.id, row });
		} catch (err) {
			results.push({
				ok: false,
				id: c.id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return { results };
}

async function tryBulkInsert(
	creates: JournalEntryCreateInputWithRelations[],
	authorUserId: string,
): Promise<JournalEntryPushCreatesResult[]> {
	const parentIds = creates.map((c) => c.id);

	await db.journalEntries
		.createMany(
			creates.map(({ files, ...parent }) => ({
				...parent,
				authorUserId,
				...(files?.length
					? {
							files: {
								create: files.map((f) => ({
									...f,
									tableName: "journalEntries" as const,
									type: "attachment" as const,
									createdByUserId: authorUserId,
								})),
							},
						}
					: {}),
			})),
		)
		.onConflictDoNothing("id");

	return await echoCanonicalRows(parentIds, creates);
}

async function insertOne(
	c: JournalEntryCreateInputWithRelations,
	authorUserId: string,
): Promise<JournalEntrySelectAllWithRelations> {
	const { files, ...parent } = c;

	await db.journalEntries
		.create({
			...parent,
			authorUserId,
			...(files?.length
				? {
						files: {
							create: files.map((f) => ({
								...f,
								tableName: "journalEntries" as const,
								type: "attachment" as const,
								createdByUserId: authorUserId,
							})),
						},
					}
				: {}),
		})
		.onConflictDoNothing("id");

	const [canonicalParent, canonicalFiles] = await Promise.all([
		db.journalEntries.find(c.id).selectAll(),
		db.files
			.where({ tableName: "journalEntries", type: "attachment", tableId: c.id })
			.selectAll(),
	]);
	return { ...canonicalParent, files: canonicalFiles as FileSelectAll[] };
}

/**
 * Fetch canonical rows for every id — covers both freshly-inserted rows
 * AND rows silently skipped by `onConflictDoNothing`. Groups the child
 * files by parent id in one pass.
 */
async function echoCanonicalRows(
	parentIds: string[],
	creates: JournalEntryCreateInputWithRelations[],
): Promise<JournalEntryPushCreatesResult[]> {
	const [canonicalParents, canonicalFiles] = await Promise.all([
		db.journalEntries.where({ id: { in: parentIds } }).selectAll(),
		db.files
			.where({
				tableName: "journalEntries",
				type: "attachment",
				tableId: { in: parentIds },
			})
			.selectAll(),
	]);

	const filesByParent = new Map<string, FileSelectAll[]>();
	for (const f of canonicalFiles as FileSelectAll[]) {
		const arr = filesByParent.get(f.tableId) ?? [];
		arr.push(f);
		filesByParent.set(f.tableId, arr);
	}
	const parentById = new Map(canonicalParents.map((p) => [p.id, p]));

	return creates.map((c): JournalEntryPushCreatesResult => {
		const parent = parentById.get(c.id);
		if (!parent) {
			return { ok: false, id: c.id, error: "Row missing after bulk insert" };
		}
		return {
			ok: true,
			id: c.id,
			row: { ...parent, files: filesByParent.get(c.id) ?? [] },
		};
	});
}
