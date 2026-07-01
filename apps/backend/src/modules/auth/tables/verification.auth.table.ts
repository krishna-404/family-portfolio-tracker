import { BaseTable } from "@backend/db/base_table";

export class VerificationTable extends BaseTable {
	readonly table = "verifications";

	columns = this.setColumns((t) => ({
		identifier: t.string(),
		value: t.text(),
		expiresAt: t.timestampNumber(),
		...t.timestampsAsNumbers(),
	}),
	(t) => [
		t.primaryKey(["identifier", "value"]),
	]);
}