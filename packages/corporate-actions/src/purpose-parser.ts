// Grammar-based parser for NSE/BSE corporate-action purpose strings — one typed extractor
// per action family, tried in order. Never guesses: anything that fails strict extraction
// comes back confidence "low" with null ratios (kite_pnl regression: malformed ratios must
// not silently produce garbage). The raw text is always retained.

import type { CorporateAction } from "./types";

export type ParsedAction = Omit<
	CorporateAction,
	"id" | "isin" | "exDate" | "recordDate" | "payDate"
>;

export type PurposeExtraction = {
	parsed: ParsedAction | null;
	confidence: "high" | "low";
	rawText: string;
};

// Rupee token: "Rs", "Rs.", "Re", "Re.", optionally followed by the "X/-" suffix form.
const RUPEE = String.raw`r(?:s|e)\.?`;
const AMOUNT = String.raw`(\d+(?:\.\d+)?)`;
const SLASH_DASH = String.raw`(?:\s*/\s*-)?`;

type Extractor = (text: string, rawText: string) => PurposeExtraction | null;

const DIVIDEND_AMOUNT_RE = new RegExp(
	String.raw`dividend\b.*?${RUPEE}\s*${AMOUNT}${SLASH_DASH}\s*per\s+share`,
	"i",
);

function extractDividend(text: string, rawText: string): PurposeExtraction | null {
	if (!/\bdividend\b/i.test(text)) return null;
	const match = DIVIDEND_AMOUNT_RE.exec(text);
	const amount = match?.[1];
	if (amount === undefined) {
		return { parsed: { type: "dividend", rawText }, confidence: "low", rawText };
	}
	return {
		parsed: { type: "dividend", amountPerShare: amount, rawText },
		confidence: "high",
		rawText,
	};
}

// Strict integer A:B directly after the keyword — "Bonus 1.501" or "Bonus 1.5:1" must NOT
// match (the digits are anchored to the keyword, so no backtracking into "501").
const BONUS_RATIO_RE = /\bbonus(?:\s+issue)?\s+(\d+)\s*:\s*(\d+)(?!\.?\d)/i;

function extractBonus(text: string, rawText: string): PurposeExtraction | null {
	if (!/\bbonus\b/i.test(text)) return null;
	const match = BONUS_RATIO_RE.exec(text);
	const newShares = match?.[1] !== undefined ? Number.parseInt(match[1], 10) : Number.NaN;
	const oldShares = match?.[2] !== undefined ? Number.parseInt(match[2], 10) : Number.NaN;
	if (
		!Number.isInteger(newShares) ||
		!Number.isInteger(oldShares) ||
		newShares < 1 ||
		oldShares < 1
	) {
		return { parsed: { type: "bonus", rawText }, confidence: "low", rawText };
	}
	// A:B = A new per B held ⇒ ratioNew=A, ratioOld=B (see types.ts).
	return {
		parsed: { type: "bonus", ratioNew: newShares, ratioOld: oldShares, rawText },
		confidence: "high",
		rawText,
	};
}

// Handles full and abbreviated forms: "Face Value Split From", "Fv Splt Frm".
const SPLIT_RE = new RegExp(
	String.raw`\bf(?:ace)?\s*\.?\s*v(?:alue)?\.?\s*spl(?:i)?t\s+fr(?:o)?m\s+${RUPEE}\s*${AMOUNT}${SLASH_DASH}\s*to\s+${RUPEE}\s*${AMOUNT}${SLASH_DASH}`,
	"i",
);
const SPLIT_HINT_RE = /\bspl(?:i)?t\b|\bsub-?division\b/i;

function extractSplit(text: string, rawText: string): PurposeExtraction | null {
	const match = SPLIT_RE.exec(text);
	if (match?.[1] !== undefined && match[2] !== undefined) {
		const fromFv = Number(match[1]);
		const toFv = Number(match[2]);
		if (
			Number.isFinite(fromFv) &&
			Number.isFinite(toFv) &&
			fromFv > 0 &&
			toFv > 0 &&
			fromFv !== toFv
		) {
			// Face values old → new: FV 10 → 1 means qtyFactor 10 (see types.ts).
			return {
				parsed: { type: "split", ratioOld: fromFv, ratioNew: toFv, rawText },
				confidence: "high",
				rawText,
			};
		}
		return { parsed: { type: "split", rawText }, confidence: "low", rawText };
	}
	if (SPLIT_HINT_RE.test(text)) {
		return { parsed: { type: "split", rawText }, confidence: "low", rawText };
	}
	return null;
}

const RIGHTS_RATIO_RE = /\brights(?:\s+issue)?\s+(\d+)\s*:\s*(\d+)(?!\.?\d)/i;
const PREMIUM_RE = new RegExp(
	String.raw`premium\s+(?:of\s+)?${RUPEE}\s*${AMOUNT}${SLASH_DASH}`,
	"i",
);

function extractRights(text: string, rawText: string): PurposeExtraction | null {
	if (!/\brights\b/i.test(text)) return null;
	const match = RIGHTS_RATIO_RE.exec(text);
	const newShares = match?.[1] !== undefined ? Number.parseInt(match[1], 10) : Number.NaN;
	const oldShares = match?.[2] !== undefined ? Number.parseInt(match[2], 10) : Number.NaN;
	if (
		!Number.isInteger(newShares) ||
		!Number.isInteger(oldShares) ||
		newShares < 1 ||
		oldShares < 1
	) {
		return { parsed: { type: "rights", rawText }, confidence: "low", rawText };
	}
	const premium = PREMIUM_RE.exec(text)?.[1];
	const parsed: ParsedAction =
		premium === undefined
			? { type: "rights", ratioNew: newShares, ratioOld: oldShares, rawText }
			: {
					type: "rights",
					ratioNew: newShares,
					ratioOld: oldShares,
					amountPerShare: premium,
					rawText,
				};
	return { parsed, confidence: "high", rawText };
}

// Demerger must run before merger — "demerger" contains "merger".
function extractDemerger(text: string, rawText: string): PurposeExtraction | null {
	if (!/\bde-?merger\b|\bspin[\s-]?off\b/i.test(text)) return null;
	return { parsed: { type: "demerger", rawText }, confidence: "low", rawText };
}

// Recognized family, ratio never in the purpose string ⇒ always low confidence.
function extractMerger(text: string, rawText: string): PurposeExtraction | null {
	if (!/\bamalgamation\b|\bmerger\b|\bamalgamated\b/i.test(text)) return null;
	return { parsed: { type: "merger", rawText }, confidence: "low", rawText };
}

function extractBuyback(text: string, rawText: string): PurposeExtraction | null {
	if (!/\bbuy\s*-?\s*back\b/i.test(text)) return null;
	return { parsed: { type: "buyback", rawText }, confidence: "low", rawText };
}

const EXTRACTORS: Extractor[] = [
	extractDividend,
	extractBonus,
	extractSplit,
	extractRights,
	extractDemerger,
	extractMerger,
	extractBuyback,
];

/**
 * Parse a free-text purpose string. High confidence only when the family AND its numbers
 * extracted cleanly; recognized families with unparseable numbers return the type with null
 * ratios at low confidence; totally unknown text (e.g. "Annual General Meeting") returns
 * parsed: null at low confidence — the caller routes low results to the actions inbox.
 */
export function parsePurpose(rawText: string): PurposeExtraction {
	const text = rawText.replace(/\s+/g, " ").trim();
	for (const extract of EXTRACTORS) {
		const result = extract(text, rawText);
		if (result !== null) return result;
	}
	return { parsed: null, confidence: "low", rawText };
}
