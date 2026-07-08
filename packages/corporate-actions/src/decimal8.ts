// Bigint fixed-point arithmetic at 8 decimal places. All kernel math goes through this —
// never floats (kite_pnl / Ghostfolio precision lessons). Values are scaled bigints:
// 1.5 shares ⇔ 150_000_000n.

export const SCALE = 100_000_000n;
export const DECIMALS = 8;

const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

/** Parse a decimal string into a fixed-8 bigint. Throws on malformed input or >8 dp. */
export function parseDecimal8(value: string): bigint {
	if (!DECIMAL_RE.test(value)) {
		throw new Error(`decimal8: malformed decimal string "${value}"`);
	}
	const negative = value.startsWith("-");
	const unsigned = negative ? value.slice(1) : value;
	const [intPart = "0", fracPart = ""] = unsigned.split(".");
	if (fracPart.length > DECIMALS) {
		throw new Error(`decimal8: "${value}" exceeds ${DECIMALS} decimal places`);
	}
	const scaled = BigInt(intPart) * SCALE + BigInt(fracPart.padEnd(DECIMALS, "0"));
	return negative ? -scaled : scaled;
}

/** Format a fixed-8 bigint back into a decimal string, trailing zeros trimmed. */
export function formatDecimal8(value: bigint): string {
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const intPart = (abs / SCALE).toString();
	const frac = (abs % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
	const out = frac.length > 0 ? `${intPart}.${frac}` : intPart;
	return negative && out !== "0" ? `-${out}` : out;
}

/** (a * num) / den with round-half-up on the absolute value. den must be non-zero. */
export function mulDiv8(a: bigint, num: bigint, den: bigint): bigint {
	if (den === 0n) throw new Error("decimal8: division by zero");
	const product = a * num;
	const negative = product < 0n !== den < 0n && product !== 0n;
	const absProduct = product < 0n ? -product : product;
	const absDen = den < 0n ? -den : den;
	const quotient = (absProduct + absDen / 2n) / absDen;
	return negative ? -quotient : quotient;
}

/** Multiply two fixed-8 values (e.g. quantity × price), rounding half-up. */
export function mulFixed8(a: bigint, b: bigint): bigint {
	return mulDiv8(a, b, SCALE);
}
