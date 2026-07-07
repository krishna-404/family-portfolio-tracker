/**
 * Minimal RFC-4180 CSV reader. Hand-rolled instead of a dependency because
 * broker exports are small (thousands of rows) and the failure modes we care
 * about — quoted fields containing commas (Zerodha ledger narrations), CRLF,
 * trailing newlines — are fully covered by the grammar below.
 */
export interface CsvParseError {
	line: number;
	message: string;
}

export interface CsvResult {
	/** First record — the header row, verbatim. */
	header: string[];
	/** Every subsequent record. */
	records: string[][];
	errors: CsvParseError[];
}

export function parseCsv(text: string): CsvResult {
	const records: string[][] = [];
	const errors: CsvParseError[] = [];
	let record: string[] = [];
	let field = "";
	let inQuotes = false;
	let line = 1;

	const endField = () => {
		record.push(field);
		field = "";
	};
	const endRecord = () => {
		endField();
		// Skip records that are entirely empty (trailing newline artifacts).
		if (record.length > 1 || record[0] !== "") records.push(record);
		record = [];
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				if (ch === "\n") line++;
				field += ch;
			}
			continue;
		}
		switch (ch) {
			case '"':
				if (field.length > 0) {
					errors.push({ line, message: "Unexpected quote inside unquoted field" });
				}
				inQuotes = true;
				break;
			case ",":
				endField();
				break;
			case "\r":
				break; // handled by the \n that follows
			case "\n":
				endRecord();
				line++;
				break;
			default:
				field += ch;
		}
	}
	if (inQuotes) errors.push({ line, message: "Unterminated quoted field" });
	if (field.length > 0 || record.length > 0) endRecord();

	const [header, ...rest] = records;
	return { header: header ?? [], records: rest, errors };
}
