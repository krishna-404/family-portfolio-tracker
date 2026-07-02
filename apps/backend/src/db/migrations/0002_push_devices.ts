import { change } from "../db_script";

change(async (db) => {
	await db.createTable(
		"push_devices",
		(t) => ({
			id: t.string(26).primaryKey(),
			userId: t.uuid().foreignKey("users", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			fcmToken: t.text().unique(),
			userAgent: t.text().nullable(),
			lastSeenAt: t.timestamp(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [
			t.index([
				"userId",
				{
					column: "lastSeenAt",
					order: "DESC",
				},
			]),
		],
	);
});
