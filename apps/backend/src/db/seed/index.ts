export const seed = async () => {
	console.info("Seeding database...");
	// Kosh has no seed data yet — reference data (instruments, price bars)
	// arrives via ingestion jobs, not seeds.
	console.info("Seeding completed successfully!");
};
