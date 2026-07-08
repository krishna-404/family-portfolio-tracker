import { describe, expect, it } from "vitest";
import { mulToMoney, signedFlowAmount } from "./decimal.imports";

describe("mulToMoney", () => {
	it("multiplies quantity × price to 2dp money", () => {
		expect(mulToMoney("10.000000", "100.000000")).toBe("1000.00");
		expect(mulToMoney("5.000000", "200.000000")).toBe("1000.00");
		expect(mulToMoney("47.000000", "578.750000")).toBe("27201.25");
	});

	it("rounds half-up at the 2dp boundary", () => {
		expect(mulToMoney("1", "0.005")).toBe("0.01");
		expect(mulToMoney("1", "0.004")).toBe("0.00");
		expect(mulToMoney("3", "0.005")).toBe("0.02"); // 0.015 → 0.02
	});

	it("handles high-precision fills without float drift", () => {
		// 48 × 578.599976 = 27772.798848 → 27772.80
		expect(mulToMoney("48.000000", "578.599976")).toBe("27772.80");
	});

	it("handles negatives", () => {
		expect(mulToMoney("-2", "3.5")).toBe("-7.00");
	});
});

describe("signedFlowAmount", () => {
	it("credit is a positive inflow", () => {
		expect(signedFlowAmount("0.000000", "10000.000000")).toBe("10000.00");
		expect(signedFlowAmount(null, "283260.766904")).toBe("283260.77");
	});

	it("debit is a negative outflow", () => {
		expect(signedFlowAmount("15.340000", "0.000000")).toBe("-15.34");
		expect(signedFlowAmount("200000.000000", null)).toBe("-200000.00");
	});

	it("treats null as zero on the opposite leg", () => {
		expect(signedFlowAmount(null, "1.000000")).toBe("1.00");
		expect(signedFlowAmount("0", "0")).toBe("0.00");
	});
});
