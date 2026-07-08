// Deterministic position replay: trades and live corporate actions interleaved
// chronologically, average-cost basis tracking. Retraction = supersession; the kernel never
// deletes — replaying with a superseded action present is byte-identical to replaying
// without it (the retract-and-reapply healing property).

import { applyActionToPosition } from "./apply";
import { formatDecimal8, mulDiv8, mulFixed8, parseDecimal8 } from "./decimal8";
import type { CorporateAction, Position, Trade } from "./types";

/** Actions that have not been retracted. Supersession filters; nothing is ever deleted. */
export function liveActions(actions: CorporateAction[]): CorporateAction[] {
	return actions.filter(
		(action) => action.supersededById === undefined || action.supersededById === null,
	);
}

// Types with a deterministic position effect; others (dividend, rights, buyback,
// symbol_change, delisting) never change quantity/cost automatically.
const POSITION_AFFECTING = new Set<CorporateAction["type"]>([
	"split",
	"bonus",
	"merger",
	"demerger",
]);

type ReplayEvent =
	| { date: string; order: 0; action: CorporateAction }
	| { date: string; order: 1; trade: Trade };

type MutablePosition = { quantity: bigint; costBasis: bigint };

/**
 * Holdings as of `asOf` (inclusive). Actions apply at the START of their ex-date — a trade
 * ON the ex-date happens in already-adjusted terms. Average-cost basis: sells remove cost
 * proportionally. Output is sorted by ISIN; zero-quantity positions are dropped. This is
 * what computes record-date holdings for dividend expectations.
 */
export function replayPositions(
	trades: Trade[],
	actions: CorporateAction[],
	asOf: string,
): Position[] {
	const events: ReplayEvent[] = [
		...liveActions(actions)
			.filter((action) => POSITION_AFFECTING.has(action.type) && action.exDate <= asOf)
			.map((action): ReplayEvent => ({ date: action.exDate, order: 0, action })),
		...trades
			.filter((trade) => trade.date <= asOf)
			.map((trade): ReplayEvent => ({ date: trade.date, order: 1, trade })),
	];
	// Stable sort: same-date actions precede same-date trades; input order otherwise kept.
	events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

	const book = new Map<string, MutablePosition>();

	for (const event of events) {
		if (event.order === 1) {
			applyTrade(book, event.trade);
		} else {
			applyAction(book, event.action);
		}
	}

	return [...book.entries()]
		.filter(([, position]) => position.quantity !== 0n)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([isin, position]) => ({
			isin,
			quantity: formatDecimal8(position.quantity),
			costBasis: formatDecimal8(position.costBasis),
		}));
}

function applyTrade(book: Map<string, MutablePosition>, trade: Trade): void {
	const qty = parseDecimal8(trade.quantity);
	const price = parseDecimal8(trade.price);
	if (qty <= 0n) throw new Error(`corporate-actions: non-positive trade quantity on ${trade.date}`);
	const held = book.get(trade.isin) ?? { quantity: 0n, costBasis: 0n };
	if (trade.side === "buy") {
		held.quantity += qty;
		held.costBasis += mulFixed8(qty, price);
	} else {
		if (qty > held.quantity) {
			// Fail loudly (kite_pnl's except:pass lesson): an oversell means missing history.
			throw new Error(
				`corporate-actions: sell of ${trade.quantity} exceeds holding of ` +
					`${formatDecimal8(held.quantity)} for ${trade.isin} on ${trade.date}`,
			);
		}
		const costRemoved =
			qty === held.quantity ? held.costBasis : mulDiv8(held.costBasis, qty, held.quantity);
		held.quantity -= qty;
		held.costBasis -= costRemoved;
	}
	book.set(trade.isin, held);
}

function applyAction(book: Map<string, MutablePosition>, action: CorporateAction): void {
	const held = book.get(action.isin);
	if (held === undefined || held.quantity === 0n) return;
	const result = applyActionToPosition(
		{
			isin: action.isin,
			quantity: formatDecimal8(held.quantity),
			costBasis: formatDecimal8(held.costBasis),
		},
		action,
	);
	if (result.position.isin !== action.isin) {
		// Merger: holding moves to the counterpart ISIN, merging with any existing stake.
		book.delete(action.isin);
		mergeInto(book, result.position);
	} else {
		book.set(action.isin, {
			quantity: parseDecimal8(result.position.quantity),
			costBasis: parseDecimal8(result.position.costBasis),
		});
	}
	if (result.childPosition !== undefined) {
		mergeInto(book, result.childPosition);
	}
}

function mergeInto(book: Map<string, MutablePosition>, position: Position): void {
	const existing = book.get(position.isin) ?? { quantity: 0n, costBasis: 0n };
	existing.quantity += parseDecimal8(position.quantity);
	existing.costBasis += parseDecimal8(position.costBasis);
	book.set(position.isin, existing);
}
