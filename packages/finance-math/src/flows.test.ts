import { CASH_FLOW_CLASSIFICATION_ENUM } from "@connected-repo/zod-schemas/enums.zod";
import { describe, expect, it } from "vitest";
import { daysBetween, isExternalFlow, utcMidnightMs } from "./flows.js";

describe("daysBetween", () => {
	it("counts whole days across a leap day", () => {
		expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
		expect(daysBetween("2023-02-28", "2023-03-01")).toBe(1);
	});

	it("is signed and zero on identical dates", () => {
		expect(daysBetween("2024-01-10", "2024-01-01")).toBe(-9);
		expect(daysBetween("2024-01-01", "2024-01-01")).toBe(0);
	});

	it("spans decades exactly (leap years included)", () => {
		// 2000..2024 inclusive of leap days: 25 years = 9132 days.
		expect(daysBetween("2000-01-01", "2025-01-01")).toBe(9132);
	});

	it("rejects malformed and impossible dates", () => {
		expect(() => daysBetween("2024-1-01", "2024-02-01")).toThrow(/YYYY-MM-DD/);
		expect(() => daysBetween("2024-02-30", "2024-03-01")).toThrow(/calendar/);
		expect(() => daysBetween("2024-13-01", "2024-03-01")).toThrow(/calendar/);
		expect(() => utcMidnightMs("2024-01-01T00:00:00Z")).toThrow(/YYYY-MM-DD/);
	});
});

describe("isExternalFlow", () => {
	it("maps every classification in the enum, external only for deposits/withdrawals", () => {
		for (const classification of CASH_FLOW_CLASSIFICATION_ENUM) {
			expect(isExternalFlow(classification)).toBe(
				classification === "external_deposit" || classification === "external_withdrawal",
			);
		}
	});

	it("throws at runtime on an unmapped classification", () => {
		// Simulates data written by a newer schema than this build was compiled against.
		const rogue = "brand_new_kind" as (typeof CASH_FLOW_CLASSIFICATION_ENUM)[number];
		expect(() => isExternalFlow(rogue)).toThrow(/Unmapped cash flow classification/);
	});
});
