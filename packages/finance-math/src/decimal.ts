/**
 * Fixed-point money arithmetic on bigint with an explicit decimal scale.
 *
 * A `ScaledDecimal` stores `value = round-free integer` such that the real
 * number it represents is `value / 10^scale`. All arithmetic stays in bigint —
 * no IEEE floats anywhere in money math. The single sanctioned float exit is
 * `toNumber`, for feeding solver inputs (XIRR/TWR work on floats by nature).
 */
export type ScaledDecimal = {
	readonly value: bigint;
	readonly scale: number;
};

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function pow10(scale: number): bigint {
	if (!Number.isInteger(scale) || scale < 0) {
		throw new Error(`Decimal scale must be a non-negative integer, got: ${scale}`);
	}
	return 10n ** BigInt(scale);
}

/**
 * Parse a decimal string (e.g. "-283260.766904") into a ScaledDecimal at the
 * given scale. Throws if the string has more fractional digits than the scale
 * can hold — silent truncation of money is never acceptable.
 */
export function parseDecimal(s: string, scale: number): ScaledDecimal {
	if (!DECIMAL_RE.test(s)) {
		throw new Error(`Not a decimal string: "${s}"`);
	}
	const neg = s.startsWith("-");
	const body = neg ? s.slice(1) : s;
	const [int = "", frac = ""] = body.split(".");
	if (frac.length > scale) {
		throw new Error(`"${s}" has ${frac.length} fractional digits; scale ${scale} would truncate`);
	}
	const scaled = BigInt(int) * pow10(scale) + BigInt(frac.padEnd(scale, "0") || "0");
	return { value: neg ? -scaled : scaled, scale };
}

/** Losslessly rescale to a wider (or equal) scale. Narrowing would truncate, so it throws. */
export function rescaleDecimal(d: ScaledDecimal, scale: number): ScaledDecimal {
	if (scale === d.scale) return d;
	if (scale < d.scale) {
		throw new Error(`Cannot narrow scale ${d.scale} -> ${scale} without losing precision`);
	}
	return { value: d.value * pow10(scale - d.scale), scale };
}

function toCommonScale(a: ScaledDecimal, b: ScaledDecimal): [bigint, bigint, number] {
	const scale = Math.max(a.scale, b.scale);
	return [rescaleDecimal(a, scale).value, rescaleDecimal(b, scale).value, scale];
}

export function addDecimal(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal {
	const [av, bv, scale] = toCommonScale(a, b);
	return { value: av + bv, scale };
}

export function subtractDecimal(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal {
	const [av, bv, scale] = toCommonScale(a, b);
	return { value: av - bv, scale };
}

/** Returns -1, 0 or 1 as a is less than, equal to, or greater than b. */
export function compareDecimal(a: ScaledDecimal, b: ScaledDecimal): -1 | 0 | 1 {
	const [av, bv] = toCommonScale(a, b);
	if (av < bv) return -1;
	if (av > bv) return 1;
	return 0;
}

/** Format back to a plain decimal string with exactly `scale` fractional digits. */
export function formatDecimal(d: ScaledDecimal): string {
	const neg = d.value < 0n;
	const abs = neg ? -d.value : d.value;
	const p = pow10(d.scale);
	const int = (abs / p).toString();
	if (d.scale === 0) return `${neg ? "-" : ""}${int}`;
	const frac = (abs % p).toString().padStart(d.scale, "0");
	return `${neg ? "-" : ""}${int}.${frac}`;
}

/**
 * THE ONLY FLOAT ESCAPE HATCH. Converts to the nearest IEEE double for solver
 * inputs (XIRR/TWR/risk). Never round-trip the result back into money storage:
 * doubles hold ~15-17 significant digits, so large paise values lose precision.
 */
export function toNumber(d: ScaledDecimal): number {
	return Number(formatDecimal(d));
}
