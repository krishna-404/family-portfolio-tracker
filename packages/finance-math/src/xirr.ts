import { daysBetween, type Flow, utcMidnightMs } from "./flows.js";

/**
 * XIRR solver, porting pyxirr's strategy (Unlicense / public domain):
 * Newton-Raphson from a fixed guess with analytic derivative, then a
 * geometric bracket scan + Brent's method as fallback; explicit handling of
 * multiple roots (lowest rate wins, all roots reported). A non-converged
 * iterate is NEVER reported as converged.
 */

const DAYS_IN_YEAR = 365; // ACT/365F, matching Excel's XIRR
const NEWTON_GUESS = 0.1;
const MAX_NEWTON_ITERATIONS = 100;
const MAX_BRENT_ITERATIONS = 200;
// Step tolerance drives Newton/Brent to machine-level residuals; the residual
// tolerance is only a guard so a stalled iterate is never declared converged.
const STEP_TOL = 1e-13;
const BRENT_XTOL = 1e-13;
const RESIDUAL_RTOL = 1e-9;
// Bracket-scan grid over growth factor x = 1+r: r from -0.999 to 10.
const SCAN_START_FACTOR = 1e-3;
const SCAN_END_FACTOR = 11;
const SCAN_STEPS = 400;
// Two roots closer than this (relative) are considered the same root.
const ROOT_DEDUPE_TOL = 1e-7;

export type XirrDiagnostics = {
	zeroCrossings: number;
	method: "newton" | "brent";
};

export type XirrResult =
	| { status: "converged"; rate: number; iterations: number; diagnostics?: XirrDiagnostics }
	| { status: "no_sign_change" }
	| { status: "no_solution" }
	| { status: "multiple_roots"; rate: number; roots: number[] };

/** One net flow per date, expressed as (days since first flow, amount). */
type NetPoint = { days: number; amount: number };

function netByDay(flows: readonly Flow[]): NetPoint[] {
	const byDate = new Map<string, number>();
	for (const f of flows) {
		utcMidnightMs(f.date); // validate eagerly, before any math
		if (!Number.isFinite(f.amount)) {
			throw new Error(`Non-finite flow amount on ${f.date}: ${f.amount}`);
		}
		byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount);
	}
	const dates = [...byDate.keys()].sort();
	const first = dates[0];
	if (first === undefined) throw new Error("xirr requires at least one flow");
	return dates.map((date) => ({
		days: daysBetween(first, date),
		amount: byDate.get(date) ?? 0,
	}));
}

/**
 * Net present value of dated flows at `rate`, discounting ACT/365F from the
 * earliest flow date (Excel-compatible): sum of cf / (1+rate)^(days/365).
 */
export function xnpv(rate: number, flows: readonly Flow[]): number {
	if (rate <= -1) throw new RangeError(`xnpv rate must be > -1, got ${rate}`);
	let sum = 0;
	for (const p of netByDay(flows)) {
		sum += p.amount * (1 + rate) ** (-p.days / DAYS_IN_YEAR);
	}
	return sum;
}

/**
 * Number of sign changes in the date-ordered, per-day-netted flow sequence
 * (zero-amount days ignored). >1 signals a possibly multi-root XIRR.
 */
export function zeroCrossingCount(flows: readonly Flow[]): number {
	let crossings = 0;
	let prevSign = 0;
	for (const p of netByDay(flows)) {
		const sign = Math.sign(p.amount);
		if (sign === 0) continue;
		if (prevSign !== 0 && sign !== prevSign) crossings++;
		prevSign = sign;
	}
	return crossings;
}

function npvAt(points: readonly NetPoint[], rate: number): number {
	let sum = 0;
	for (const p of points) {
		sum += p.amount * (1 + rate) ** (-p.days / DAYS_IN_YEAR);
	}
	return sum;
}

function npvDerivativeAt(points: readonly NetPoint[], rate: number): number {
	let sum = 0;
	for (const p of points) {
		const exp = -p.days / DAYS_IN_YEAR;
		sum += p.amount * exp * (1 + rate) ** (exp - 1);
	}
	return sum;
}

type SolverHit = { rate: number; iterations: number };

function newtonRaphson(
	points: readonly NetPoint[],
	guess: number,
	residualTol: number,
): SolverHit | undefined {
	let rate = guess;
	for (let i = 1; i <= MAX_NEWTON_ITERATIONS; i++) {
		const fv = npvAt(points, rate);
		if (!Number.isFinite(fv)) return undefined;
		const dv = npvDerivativeAt(points, rate);
		if (dv === 0 || !Number.isFinite(dv)) return undefined;
		let next = rate - fv / dv;
		// The domain is rate > -1: if a step overshoots the pole, bisect toward it.
		if (next <= -1) next = (rate - 1) / 2;
		if (!Number.isFinite(next)) return undefined;
		if (Math.abs(next - rate) <= STEP_TOL * Math.max(1, Math.abs(next))) {
			// Step converged; accept only if it actually solves the equation.
			if (Math.abs(npvAt(points, next)) <= residualTol) return { rate: next, iterations: i };
			return undefined;
		}
		rate = next;
	}
	return undefined;
}

/** Brent's method (Numerical Recipes zbrent) on a sign-change bracket [a, b]. */
function brentSolve(
	points: readonly NetPoint[],
	a0: number,
	b0: number,
	fa0: number,
	fb0: number,
): SolverHit | undefined {
	let a = a0;
	let b = b0;
	let fa = fa0;
	let fb = fb0;
	if (fa * fb > 0) return undefined;
	let c = b;
	let fc = fb;
	let d = b - a;
	let e = d;
	for (let iter = 1; iter <= MAX_BRENT_ITERATIONS; iter++) {
		if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
			c = a;
			fc = fa;
			d = b - a;
			e = d;
		}
		if (Math.abs(fc) < Math.abs(fb)) {
			a = b;
			b = c;
			c = a;
			fa = fb;
			fb = fc;
			fc = fa;
		}
		const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * BRENT_XTOL;
		const xm = 0.5 * (c - b);
		if (Math.abs(xm) <= tol1 || fb === 0) return { rate: b, iterations: iter };
		if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
			// Attempt inverse quadratic interpolation / secant.
			const s = fb / fa;
			let p: number;
			let q: number;
			if (a === c) {
				p = 2 * xm * s;
				q = 1 - s;
			} else {
				const qq = fa / fc;
				const r = fb / fc;
				p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
				q = (qq - 1) * (r - 1) * (s - 1);
			}
			if (p > 0) q = -q;
			p = Math.abs(p);
			const min1 = 3 * xm * q - Math.abs(tol1 * q);
			const min2 = Math.abs(e * q);
			if (2 * p < Math.min(min1, min2)) {
				e = d;
				d = p / q;
			} else {
				d = xm;
				e = d;
			}
		} else {
			d = xm;
			e = d;
		}
		a = b;
		fa = fb;
		b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
		fb = npvAt(points, b);
		if (!Number.isFinite(fb)) return undefined;
	}
	return undefined;
}

/** Scan a geometric grid of growth factors for sign-change brackets, Brent each one. */
function scanForRoots(points: readonly NetPoint[], residualTol: number): SolverHit[] {
	const hits: SolverHit[] = [];
	const factor = (SCAN_END_FACTOR / SCAN_START_FACTOR) ** (1 / SCAN_STEPS);
	let x = SCAN_START_FACTOR;
	let prevRate = x - 1;
	let prevF = npvAt(points, prevRate);
	for (let i = 1; i <= SCAN_STEPS; i++) {
		x *= factor;
		const rate = x - 1;
		const fv = npvAt(points, rate);
		if (Number.isFinite(prevF) && Number.isFinite(fv)) {
			if (prevF === 0) {
				hits.push({ rate: prevRate, iterations: 0 });
			} else if (prevF * fv < 0) {
				const hit = brentSolve(points, prevRate, rate, prevF, fv);
				if (hit !== undefined && Math.abs(npvAt(points, hit.rate)) <= residualTol) {
					hits.push(hit);
				}
			}
		}
		prevRate = rate;
		prevF = fv;
	}
	if (Number.isFinite(prevF) && prevF === 0) hits.push({ rate: prevRate, iterations: 0 });
	return hits;
}

function dedupeSortedRates(hits: readonly SolverHit[]): SolverHit[] {
	const sorted = [...hits].sort((l, r) => l.rate - r.rate);
	const out: SolverHit[] = [];
	for (const hit of sorted) {
		const last = out[out.length - 1];
		if (last !== undefined && Math.abs(hit.rate - last.rate) <= ROOT_DEDUPE_TOL * Math.max(1, Math.abs(hit.rate))) {
			continue;
		}
		out.push(hit);
	}
	return out;
}

/**
 * Solve for the internal rate of return of irregularly dated flows.
 *
 * Structural invalidity (fewer than 2 flows, all flows on one day, bad dates)
 * throws; solvable-but-degenerate inputs come back as typed statuses.
 * When the flow sequence changes sign more than once, every root on
 * (-0.999, 10] is located and the LOWEST rate is returned (conservative),
 * with all roots attached.
 */
export function xirr(flows: readonly Flow[]): XirrResult {
	if (flows.length < 2) {
		throw new Error(`xirr requires at least 2 flows, got ${flows.length}`);
	}
	const points = netByDay(flows);
	const lastPoint = points[points.length - 1];
	if (lastPoint === undefined || lastPoint.days === 0) {
		throw new Error("xirr is undefined when all flows fall on the same day");
	}

	let hasPositive = false;
	let hasNegative = false;
	let totalAbs = 0;
	for (const p of points) {
		if (p.amount > 0) hasPositive = true;
		if (p.amount < 0) hasNegative = true;
		totalAbs += Math.abs(p.amount);
	}
	if (!hasPositive || !hasNegative) return { status: "no_sign_change" };

	const crossings = zeroCrossingCount(flows);
	const residualTol = Math.max(RESIDUAL_RTOL * totalAbs, 1e-12);

	if (crossings === 1) {
		// A single sign change: treat the root as unique (pyxirr convention).
		const newton = newtonRaphson(points, NEWTON_GUESS, residualTol);
		if (newton !== undefined) {
			return {
				status: "converged",
				rate: newton.rate,
				iterations: newton.iterations,
				diagnostics: { zeroCrossings: crossings, method: "newton" },
			};
		}
		const scanned = dedupeSortedRates(scanForRoots(points, residualTol));
		const first = scanned[0];
		if (first === undefined) return { status: "no_solution" };
		return {
			status: "converged",
			rate: first.rate,
			iterations: first.iterations,
			diagnostics: { zeroCrossings: crossings, method: "brent" },
		};
	}

	// Multiple sign changes: hunt every root, not just the one Newton falls into.
	const hits = scanForRoots(points, residualTol);
	const newton = newtonRaphson(points, NEWTON_GUESS, residualTol);
	if (newton !== undefined) hits.push(newton); // grid may miss a root outside/between cells
	const roots = dedupeSortedRates(hits);
	const lowest = roots[0];
	if (lowest === undefined) return { status: "no_solution" };
	if (roots.length === 1) {
		return {
			status: "converged",
			rate: lowest.rate,
			iterations: lowest.iterations,
			diagnostics: { zeroCrossings: crossings, method: newton !== undefined ? "newton" : "brent" },
		};
	}
	return {
		status: "multiple_roots",
		rate: lowest.rate,
		roots: roots.map((h) => h.rate),
	};
}
