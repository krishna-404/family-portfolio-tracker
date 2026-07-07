import { describe, expect, it } from "vitest";
import { parsePurpose } from "./purpose-parser";

describe("dividend purpose strings", () => {
	it.each([
		["Dividend - Rs 8 Per Share", "8"],
		["Interim Dividend - Rs 5.50 Per Share", "5.50"],
		["Final Dividend - Re 0.50 Per Share", "0.50"],
		["Special Dividend - Rs 2 Per Share", "2"],
		["Dividend - Rs.3/- Per Share", "3"],
	])("parses %j", (rawText, amount) => {
		const result = parsePurpose(rawText);
		expect(result.confidence).toBe("high");
		expect(result.parsed?.type).toBe("dividend");
		expect(result.parsed?.amountPerShare).toBe(amount);
		expect(result.rawText).toBe(rawText);
	});

	it("dividend without a parseable amount is low confidence with null amount", () => {
		const result = parsePurpose("Dividend");
		expect(result.confidence).toBe("low");
		expect(result.parsed?.type).toBe("dividend");
		expect(result.parsed?.amountPerShare).toBeUndefined();
	});

	it("is case-insensitive with flexible whitespace", () => {
		const result = parsePurpose("  dividend   -   rs   8   per   share  ");
		expect(result.confidence).toBe("high");
		expect(result.parsed?.amountPerShare).toBe("8");
	});
});

describe("bonus purpose strings", () => {
	it.each([
		["Bonus 1:1", 1, 1],
		["Bonus 1:2", 1, 2],
		["Bonus 32:21", 32, 21],
		["Bonus Issue 3:1", 3, 1],
	])("parses %j as new=%i old=%i", (rawText, ratioNew, ratioOld) => {
		const result = parsePurpose(rawText);
		expect(result.confidence).toBe("high");
		expect(result.parsed?.type).toBe("bonus");
		expect(result.parsed?.ratioNew).toBe(ratioNew);
		expect(result.parsed?.ratioOld).toBe(ratioOld);
	});

	it.each([
		"Bonus 1.501",
		"Bonus 1.5:1",
		"Bonus 1:2.5",
		"Bonus 0:1",
	])("malformed ratio %j returns low confidence with null ratios (kite_pnl regression)", (rawText) => {
		const result = parsePurpose(rawText);
		expect(result.confidence).toBe("low");
		expect(result.parsed?.type).toBe("bonus");
		expect(result.parsed?.ratioNew).toBeUndefined();
		expect(result.parsed?.ratioOld).toBeUndefined();
	});

	it("case variant BONUS 1:1 parses", () => {
		expect(parsePurpose("BONUS 1:1").confidence).toBe("high");
	});
});

describe("split purpose strings", () => {
	it.each([
		["Face Value Split From Rs.10/- To Re.1/-", 10, 1],
		["Face Value Split From Rs 2 To Re 1", 2, 1],
		["Fv Splt Frm Rs.10/- To Re.1/-", 10, 1],
		["Face Value Split From Rs.5/- To Rs.2/-", 5, 2],
	])("parses %j as FV old=%i new=%i", (rawText, ratioOld, ratioNew) => {
		const result = parsePurpose(rawText);
		expect(result.confidence).toBe("high");
		expect(result.parsed?.type).toBe("split");
		expect(result.parsed?.ratioOld).toBe(ratioOld);
		expect(result.parsed?.ratioNew).toBe(ratioNew);
	});

	it("split with unparseable face values is low confidence with null ratios", () => {
		const result = parsePurpose("Stock Split - see announcement");
		expect(result.confidence).toBe("low");
		expect(result.parsed?.type).toBe("split");
		expect(result.parsed?.ratioOld).toBeUndefined();
	});

	it("degenerate FV X to X is low confidence", () => {
		const result = parsePurpose("Face Value Split From Rs.10/- To Rs.10/-");
		expect(result.confidence).toBe("low");
		expect(result.parsed?.ratioOld).toBeUndefined();
	});
});

describe("rights purpose strings", () => {
	it("parses ratio with premium", () => {
		const result = parsePurpose("Rights 1:5 @ Premium Rs 10/-");
		expect(result.confidence).toBe("high");
		expect(result.parsed?.type).toBe("rights");
		expect(result.parsed?.ratioNew).toBe(1);
		expect(result.parsed?.ratioOld).toBe(5);
		expect(result.parsed?.amountPerShare).toBe("10");
	});

	it("parses ratio without premium", () => {
		const result = parsePurpose("Rights 2:7");
		expect(result.confidence).toBe("high");
		expect(result.parsed?.ratioNew).toBe(2);
		expect(result.parsed?.ratioOld).toBe(7);
		expect(result.parsed?.amountPerShare).toBeUndefined();
	});

	it("rights without ratio is low confidence", () => {
		const result = parsePurpose("Rights Issue of Equity Shares");
		expect(result.confidence).toBe("low");
		expect(result.parsed?.type).toBe("rights");
	});
});

describe("recognized-but-unparseable families and unknown text", () => {
	it("Buy Back of Shares → buyback, low, null ratios", () => {
		const result = parsePurpose("Buy Back of Shares");
		expect(result.confidence).toBe("low");
		expect(result.parsed?.type).toBe("buyback");
		expect(result.parsed?.ratioOld).toBeUndefined();
	});

	it("Amalgamation → merger, low", () => {
		const result = parsePurpose("Amalgamation");
		expect(result.parsed?.type).toBe("merger");
		expect(result.confidence).toBe("low");
	});

	it("Demerger routes to demerger, not merger", () => {
		expect(parsePurpose("Demerger").parsed?.type).toBe("demerger");
	});

	it("Annual General Meeting → parsed null, low", () => {
		const result = parsePurpose("Annual General Meeting");
		expect(result.parsed).toBeNull();
		expect(result.confidence).toBe("low");
		expect(result.rawText).toBe("Annual General Meeting");
	});
});
