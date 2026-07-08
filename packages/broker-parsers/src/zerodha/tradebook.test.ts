import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseZerodhaTradebook } from "./tradebook.js";

const FIXTURE = readFileSync(new URL("./__fixtures__/tradebook.csv", import.meta.url), "utf8");

const HEADER =
	"symbol,isin,trade_date,exchange,segment,series,trade_type,auction," +
	"quantity,price,trade_id,order_id,order_execution_time";

describe("parseZerodhaTradebook", () => {
	it("parses the fixture into normalized rows", () => {
		const res = parseZerodhaTradebook(FIXTURE);
		expect(res.errors).toEqual([]);
		expect(res.rows).toHaveLength(4);
		const first = res.rows[0];
		expect(first).toMatchObject({
			symbol: "ALPHAX",
			isin: "INE001A01011",
			tradeDate: "2025-09-05",
			exchange: "NSE",
			side: "sell",
			auction: false,
			quantity: "47.000000",
			price: "578.750000",
			brokerTradeId: "8357800",
			brokerOrderId: "1700000000000000001",
			executedAt: "2025-09-05T13:37:40",
		});
		expect(res.meta.tradeDateSpan).toEqual({ from: "2025-09-05", to: "2025-10-01" });
	});

	it("keeps quantity/price as decimal strings — never floats", () => {
		const res = parseZerodhaTradebook(FIXTURE);
		expect(res.rows[1]?.price).toBe("578.599976");
	});

	it("groups multi-fill orders by order_id while keeping distinct trade_ids", () => {
		const res = parseZerodhaTradebook(FIXTURE);
		const fills = res.rows.filter((r) => r.brokerOrderId === "1700000000000000001");
		expect(fills).toHaveLength(2);
		expect(new Set(fills.map((f) => f.brokerTradeId)).size).toBe(2);
	});

	it("fails loudly on a foreign header (format-change tripwire)", () => {
		const res = parseZerodhaTradebook("a,b,c\n1,2,3\n");
		expect(res.rows).toEqual([]);
		expect(res.errors[0]?.code).toBe("bad_header");
	});

	it("keeps rows with EMPTY isin (real-world: fresh listings) as null for mapping prompts", () => {
		const body = [
			HEADER,
			"NEWLIST,,2025-11-11,BSE,EQ,B,buy,false,50.0,110.0,t9,o9,",
		].join("\n");
		const res = parseZerodhaTradebook(body);
		expect(res.errors).toEqual([]);
		expect(res.rows[0]?.isin).toBeNull();
	});

	it("rejects bad rows individually and keeps good ones", () => {
		const body = [
			HEADER,
			// MALFORMED (non-empty) ISIN is still an error
			"X,NOTANISIN,2025-09-05,NSE,EQ,EQ,buy,false,1.0,10.0,t1,o1,",
			// bad date
			"X,INE001A01011,2025-13-40,NSE,EQ,EQ,buy,false,1.0,10.0,t2,o2,",
			// zero quantity
			"X,INE001A01011,2025-09-05,NSE,EQ,EQ,buy,false,0,10.0,t3,o3,",
			// unknown trade_type
			"X,INE001A01011,2025-09-05,NSE,EQ,EQ,short,false,1.0,10.0,t4,o4,",
			// good row on an unknown exchange → normalized to "other"
			"X,INE001A01011,2025-09-05,MCX,EQ,EQ,buy,false,1.0,10.0,t5,o5,",
		].join("\n");
		const res = parseZerodhaTradebook(body);
		expect(res.errors.map((e) => e.code)).toEqual([
			"bad_isin",
			"bad_date",
			"bad_number",
			"bad_enum",
		]);
		expect(res.rows).toHaveLength(1);
		expect(res.rows[0]?.exchange).toBe("other");
		expect(res.rows[0]?.executedAt).toBeNull();
	});
});
