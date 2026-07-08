/**
 * Fixed-point arithmetic at 6 decimal places on bigint — the precision
 * Zerodha ledgers publish (`net_balance` has 6dp). Used for the ledger
 * balance-reproduction gate, where IEEE floats would accumulate exactly the
 * kind of dust that makes an honest mismatch indistinguishable from noise.
 */
export const DEC6_SCALE = 6n;
const POW = 10n ** DEC6_SCALE;

/** Parse a decimal string (e.g. "-283260.766904") to scaled bigint micros. */
export function dec6(s: string): bigint {
	const neg = s.startsWith("-");
	const body = neg ? s.slice(1) : s;
	const [int = "", frac = ""] = body.split(".");
	if (!/^\d+$/.test(int) || (frac !== "" && !/^\d+$/.test(frac))) {
		throw new Error(`Not a decimal string: ${s}`);
	}
	if (frac.length > 6) {
		// Broker files never exceed 6dp; more precision would silently truncate.
		throw new Error(`More than 6 decimal places: ${s}`);
	}
	const scaled = BigInt(int) * POW + BigInt(frac.padEnd(6, "0"));
	return neg ? -scaled : scaled;
}

export function dec6ToString(v: bigint): string {
	const neg = v < 0n;
	const abs = neg ? -v : v;
	const int = abs / POW;
	const frac = (abs % POW).toString().padStart(6, "0");
	return `${neg ? "-" : ""}${int}.${frac}`;
}
