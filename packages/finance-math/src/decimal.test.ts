import { describe, expect, it } from "vitest";
import {
	addDecimal,
	compareDecimal,
	formatDecimal,
	parseDecimal,
	rescaleDecimal,
	subtractDecimal,
	toNumber,
} from "./decimal.js";

describe("parseDecimal / formatDecimal", () => {
	it("round-trips plain values", () => {
		for (const s of ["0.00", "1.50", "-283260.77", "999999.99", "-0.01"]) {
			expect(formatDecimal(parseDecimal(s, 2))).toBe(s);
		}
	});

	it("round-trips at scale 0", () => {
		expect(formatDecimal(parseDecimal("42", 0))).toBe("42");
		expect(formatDecimal(parseDecimal("-42", 0))).toBe("-42");
	});

	it("pads short fractions to the scale", () => {
		expect(formatDecimal(parseDecimal("1.5", 6))).toBe("1.500000");
		expect(formatDecimal(parseDecimal("7", 2))).toBe("7.00");
	});

	it("holds 18 significant digits without loss (beyond IEEE double)", () => {
		// 123456789012.345678 as a double would already be rounded.
		const s = "123456789012.345678";
		const d = parseDecimal(s, 6);
		expect(formatDecimal(d)).toBe(s);
		expect(d.value).toBe(123456789012345678n);

		const t = "0.123456789012345678";
		expect(formatDecimal(parseDecimal(t, 18))).toBe(t);
	});

	it("carries exactly across the 18-digit boundary", () => {
		const sum = addDecimal(parseDecimal("999999999999.999999", 6), parseDecimal("0.000001", 6));
		expect(formatDecimal(sum)).toBe("1000000000000.000000");
	});

	it("rejects fractions finer than the scale instead of truncating", () => {
		expect(() => parseDecimal("1.123", 2)).toThrow(/truncate/);
	});

	it("rejects non-decimal strings", () => {
		for (const bad of ["", "1,000", "1.2.3", "abc", "1e5", ".", "--1"]) {
			expect(() => parseDecimal(bad, 2)).toThrow(/decimal/i);
		}
	});
});

describe("arithmetic", () => {
	it("addition is associative", () => {
		const a = parseDecimal("123456789.123456", 6);
		const b = parseDecimal("-987654321.654321", 6);
		const c = parseDecimal("0.000001", 6);
		const left = addDecimal(addDecimal(a, b), c);
		const right = addDecimal(a, addDecimal(b, c));
		expect(compareDecimal(left, right)).toBe(0);
		expect(formatDecimal(left)).toBe(formatDecimal(right));
	});

	it("add/subtract are exact inverses", () => {
		const a = parseDecimal("0.10", 2);
		const b = parseDecimal("0.20", 2);
		// The classic float failure: 0.1 + 0.2 !== 0.3. Here it is exact.
		expect(formatDecimal(addDecimal(a, b))).toBe("0.30");
		expect(formatDecimal(subtractDecimal(addDecimal(a, b), b))).toBe("0.10");
	});

	it("mixes scales losslessly by widening", () => {
		const sum = addDecimal(parseDecimal("1.5", 1), parseDecimal("0.25", 2));
		expect(sum.scale).toBe(2);
		expect(formatDecimal(sum)).toBe("1.75");
	});

	it("compares across scales", () => {
		expect(compareDecimal(parseDecimal("1.5", 1), parseDecimal("1.50", 2))).toBe(0);
		expect(compareDecimal(parseDecimal("-2", 0), parseDecimal("1.00", 2))).toBe(-1);
		expect(compareDecimal(parseDecimal("2.01", 2), parseDecimal("2.0", 1))).toBe(1);
	});

	it("refuses lossy narrowing", () => {
		expect(() => rescaleDecimal(parseDecimal("1.23", 2), 1)).toThrow(/narrow/);
	});
});

describe("toNumber (the float escape hatch)", () => {
	it("converts exactly representable values", () => {
		expect(toNumber(parseDecimal("0.5", 6))).toBe(0.5);
		expect(toNumber(parseDecimal("-10000", 2))).toBe(-10000);
	});

	it("returns the nearest double for inexact values", () => {
		expect(toNumber(parseDecimal("0.1", 6))).toBeCloseTo(0.1, 15);
	});
});
