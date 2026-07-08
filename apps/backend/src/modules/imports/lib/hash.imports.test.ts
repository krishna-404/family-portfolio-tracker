import { describe, expect, it } from "vitest";
import { ledgerLineHash, sha256Hex } from "./hash.imports";

describe("sha256Hex", () => {
	it("is deterministic and 64 hex chars", () => {
		const a = sha256Hex("hello");
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex("hello")).toBe(a);
		expect(sha256Hex("hellO")).not.toBe(a);
	});
});

describe("ledgerLineHash", () => {
	const base = {
		accountId: "acc1",
		postedDate: "2025-09-01",
		narration: "Funds added using UPI",
		debit: null,
		credit: "10000.000000",
	};

	it("collides for identical lines (dedupe key across re-uploaded files)", () => {
		expect(ledgerLineHash(base)).toBe(ledgerLineHash({ ...base }));
	});

	it("differs when any identifying field changes", () => {
		const h = ledgerLineHash(base);
		expect(ledgerLineHash({ ...base, accountId: "acc2" })).not.toBe(h);
		expect(ledgerLineHash({ ...base, postedDate: "2025-09-02" })).not.toBe(h);
		expect(
			ledgerLineHash({ ...base, narration: "Funds added using NEFT" }),
		).not.toBe(h);
		expect(ledgerLineHash({ ...base, credit: "10000.000001" })).not.toBe(h);
	});

	it("distinguishes a debit from a credit of the same magnitude", () => {
		const credit = ledgerLineHash({
			...base,
			debit: null,
			credit: "100.000000",
		});
		const debit = ledgerLineHash({
			...base,
			debit: "100.000000",
			credit: null,
		});
		expect(credit).not.toBe(debit);
	});
});
