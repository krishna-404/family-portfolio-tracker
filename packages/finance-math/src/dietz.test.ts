import { describe, expect, it } from "vitest";
import { modifiedDietz } from "./dietz.js";

describe("modifiedDietz", () => {
	it("hand-computed: mid-period deposit, 100-day window", () => {
		// start 1000, deposit 500 at day 50 of 100, end 1650:
		// gain = 1650 - 1000 - 500 = 150; avg capital = 1000 + 500*0.5 = 1250.
		const result = modifiedDietz({
			startDate: "2024-01-01",
			endDate: "2024-04-10",
			startValue: 1000,
			endValue: 1650,
			flows: [{ date: "2024-02-20", amount: -500 }], // investor-pocket: deposit is negative
		});
		expect(result.days).toBe(100);
		expect(result.netExternalFlow).toBeCloseTo(500, 12);
		expect(result.averageCapital).toBeCloseTo(1250, 12);
		expect(result.returnRate).toBeCloseTo(0.12, 12);
		expect(result.annualized).toBeCloseTo(1.12 ** 3.65 - 1, 12);
	});

	it("withdrawals reduce capital with day weighting", () => {
		// Withdrawal of 200 at day 75 of 100: weight 0.25, portfolio cf = -200.
		const result = modifiedDietz({
			startDate: "2024-01-01",
			endDate: "2024-04-10",
			startValue: 1000,
			endValue: 900,
			flows: [{ date: "2024-03-16", amount: 200 }],
		});
		expect(result.netExternalFlow).toBeCloseTo(-200, 12);
		expect(result.averageCapital).toBeCloseTo(1000 - 200 * 0.25, 12);
		// gain = 900 - 1000 + 200 = 100 over 950
		expect(result.returnRate).toBeCloseTo(100 / 950, 12);
	});

	it("no flows degenerates to simple return", () => {
		const result = modifiedDietz({
			startDate: "2024-01-01",
			endDate: "2025-01-01",
			startValue: 1000,
			endValue: 1100,
			flows: [],
		});
		expect(result.returnRate).toBeCloseTo(0.1, 12);
	});

	it("rejects flows outside the window and empty windows", () => {
		const base = {
			startDate: "2024-01-01",
			endDate: "2024-02-01",
			startValue: 1000,
			endValue: 1100,
		};
		expect(() =>
			modifiedDietz({ ...base, flows: [{ date: "2024-03-01", amount: -100 }] }),
		).toThrow(/outside the window/);
		expect(() =>
			modifiedDietz({ ...base, endDate: "2024-01-01", flows: [] }),
		).toThrow(/after startDate/);
	});
});
