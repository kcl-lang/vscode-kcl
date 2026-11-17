/**
 * Find KCL programs embedded in YAML block scalars and map them back to the
 * host document. Crossplane function-kcl stores the program in the `source`
 * block of a `kind: KCLInput` object. Any other block can opt in with a
 * `# kcl` comment on its header, matching the convention used by YAML
 * embedded-language extensions.
 */

export type EmbeddedKclKind = 'marker' | 'kcl-input';

export interface EmbeddedKclRegion {
	/** 0-based line of the `key: |` header. Not part of the KCL text. */
	headerLine: number;
	/** Inclusive 0-based first line of block content. */
	contentStartLine: number;
	/** Exclusive 0-based line where the block ends. */
	contentEndLine: number;
	/** Columns of YAML indentation removed so the program is top-level KCL. */
	indent: number;
	kind: EmbeddedKclKind;
}

export interface LineToken {
	start: number;
	length: number;
	type: 'keyword' | 'type' | 'string' | 'number' | 'comment';
}

const EXPLICIT_BLOCK = /^([ ]*)(?:[^\s:#][^:#]*?[ \t]*:[ \t]*)?(?:\||>)(?:[1-9][-+]?|[-+][1-9]?)?[ \t]+#[ \t]*kcl\b.*$/i;
const KIND_KCL_INPUT = /^([ ]*)(-[ \t]+)?kind:[ \t]+(?:KCLInput|"KCLInput"|'KCLInput')[ \t]*(?:#.*)?$/;
const SOURCE_BLOCK = /^([ ]*)source[ \t]*:[ \t]*(?:\||>)(?:([1-9])[-+]?|[-+]([1-9])?)?[ \t]*(?:#.*)?$/;
const DOC_SEPARATOR = /^(?:---|\.\.\.)[ \t]*$/;

const KEYWORDS = new Set([
	'as', 'assert', 'if', 'elif', 'else', 'lambda', 'for', 'import', 'schema', 'protocol',
	'rule', 'mixin', 'check', 'and', 'in', 'is', 'not', 'or', 'all', 'any', 'map', 'filter', 'type',
	'True', 'False', 'None', 'Undefined',
]);
const TYPES = new Set(['str', 'int', 'float', 'bool']);

interface OpenSection {
	indent: number;
	listItem: boolean;
}

export function findEmbeddedKclRegions(text: string): EmbeddedKclRegion[] {
	const lines = splitLines(text);
	const regions: EmbeddedKclRegion[] = [];
	const sections: OpenSection[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (DOC_SEPARATOR.test(line)) {
			sections.length = 0;
			continue;
		}

		if (line.trim() !== '') {
			const indent = leadingSpaces(line);
			while (sections.length > 0) {
				const section = sections[sections.length - 1];
				const closesList = section.listItem && isListItemAt(line, section.indent);
				if (indent < section.indent || closesList) {
					sections.pop();
					continue;
				}
				break;
			}
		}

		if (EXPLICIT_BLOCK.test(line)) {
			const region = readBlock(lines, i, leadingSpaces(line), explicitIndent(line), 'marker');
			regions.push(region);
			i = region.contentEndLine - 1;
			continue;
		}

		const kind = line.match(KIND_KCL_INPUT);
		if (kind) {
			sections.push({ indent: kind[1].length, listItem: Boolean(kind[2]) });
			continue;
		}

		if (sections.length > 0) {
			const source = line.match(SOURCE_BLOCK);
			if (source) {
				const indicator = source[2] || source[3];
				const region = readBlock(lines, i, source[1].length, indicator ? Number(indicator) : undefined, 'kcl-input');
				regions.push(region);
				i = region.contentEndLine - 1;
			}
		}
	}

	return regions;
}

export function regionAt(regions: readonly EmbeddedKclRegion[], line: number): EmbeddedKclRegion | undefined {
	return regions.find(region => line >= region.contentStartLine && line < region.contentEndLine);
}

/**
 * Build a KCL document whose line numbers match the host YAML document.
 * Lines outside the region are blank. Content lines are dedented.
 */
export function renderVirtualDocument(text: string, region: EmbeddedKclRegion): string {
	const lines = splitLines(text);
	const rendered = lines.map((line, index) => {
		if (index < region.contentStartLine || index >= region.contentEndLine) {
			return '';
		}
		if (line.trim() === '') {
			return '';
		}
		return line.slice(Math.min(region.indent, leadingSpaces(line)));
	});
	return rendered.join('\n');
}

export function hostPositionToVirtual(line: number, character: number, region: EmbeddedKclRegion): { line: number; character: number } | undefined {
	if (line < region.contentStartLine || line >= region.contentEndLine) {
		return undefined;
	}
	return { line, character: Math.max(0, character - region.indent) };
}

export function virtualPositionToHost(line: number, character: number, region: EmbeddedKclRegion): { line: number; character: number } {
	if (line < region.contentStartLine || line >= region.contentEndLine) {
		return { line, character };
	}
	return { line, character: character + region.indent };
}

/** Indent text inserted into a YAML block so continuation lines stay in the scalar. */
export function indentInsertedText(text: string, indent: number): string {
	if (indent <= 0 || text.indexOf('\n') === -1) {
		return text;
	}
	const pad = ' '.repeat(indent);
	return text.replace(/\r?\n/g, match => match + pad);
}

/**
 * Lightweight KCL tokenization for lines that the YAML grammar owns, such as a
 * Crossplane `source` block that has no `# kcl` marker. Marker blocks are
 * highlighted by the injection grammar instead.
 */
export function classifyKclLine(line: string): LineToken[] {
	const tokens: LineToken[] = [];
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === ' ' || ch === '\t') {
			i++;
			continue;
		}
		if (ch === '#') {
			tokens.push({ start: i, length: line.length - i, type: 'comment' });
			break;
		}
		if (ch === '"' || ch === "'") {
			const consumed = scanString(line, i);
			tokens.push({ start: i, length: consumed, type: 'string' });
			i += consumed;
			continue;
		}
		if (isNumberStart(line, i)) {
			const consumed = scanNumber(line, i);
			tokens.push({ start: i, length: consumed, type: 'number' });
			i += consumed;
			continue;
		}
		if (isIdentStart(ch)) {
			const start = i;
			i++;
			while (i < line.length && isIdentPart(line[i])) {
				i++;
			}
			const word = line.slice(start, i);
			if (TYPES.has(word)) {
				tokens.push({ start, length: word.length, type: 'type' });
			} else if (KEYWORDS.has(word)) {
				tokens.push({ start, length: word.length, type: 'keyword' });
			}
			continue;
		}
		i++;
	}
	return tokens;
}

function readBlock(lines: string[], headerLine: number, headerIndent: number, absoluteIndent: number | undefined, kind: EmbeddedKclKind): EmbeddedKclRegion {
	let contentIndent = absoluteIndent !== undefined && absoluteIndent > headerIndent ? absoluteIndent : undefined;
	let end = headerLine + 1;
	for (let i = headerLine + 1; i < lines.length; i++) {
		const raw = lines[i];
		if (raw.trim() === '') {
			end = i + 1;
			continue;
		}
		if (DOC_SEPARATOR.test(raw)) {
			break;
		}
		const indent = leadingSpaces(raw);
		if (contentIndent === undefined) {
			if (indent <= headerIndent) {
				break;
			}
			contentIndent = indent;
		}
		if (indent < contentIndent) {
			break;
		}
		end = i + 1;
	}
	return {
		headerLine,
		contentStartLine: headerLine + 1,
		contentEndLine: end,
		indent: contentIndent ?? 0,
		kind,
	};
}

function explicitIndent(line: string): number | undefined {
	const indicator = line.match(/(?:\||>)(?:([1-9])[-+]?|[-+]([1-9])?)?(?=[ \t]+#)/);
	if (!indicator) {
		return undefined;
	}
	const digits = indicator[1] || indicator[2];
	return digits ? Number(digits) : undefined;
}

function isListItemAt(line: string, indent: number): boolean {
	if (!line.startsWith(' '.repeat(indent))) {
		return false;
	}
	const rest = line.slice(indent);
	return rest.startsWith('- ') || rest === '-' || rest.startsWith('-\t');
}

function leadingSpaces(line: string): number {
	let count = 0;
	while (count < line.length && line[count] === ' ') {
		count++;
	}
	return count;
}

function splitLines(text: string): string[] {
	return text.split(/\r?\n/);
}

function isIdentStart(ch: string): boolean {
	return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isNumberStart(line: string, index: number): boolean {
	const ch = line[index];
	if (ch >= '0' && ch <= '9') {
		return true;
	}
	if (ch === '-' || ch === '.') {
		const next = line[index + 1];
		return Boolean(next && next >= '0' && next <= '9');
	}
	return false;
}

function scanNumber(line: string, index: number): number {
	const rest = line.slice(index);
	const matched = /^-?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+|\d+)/.exec(rest);
	return matched ? matched[0].length : 1;
}

function scanString(line: string, index: number): number {
	const quote = line[index];
	if (line.startsWith(quote + quote + quote, index)) {
		const close = line.indexOf(quote + quote + quote, index + 3);
		return close === -1 ? line.length - index : close + 3 - index;
	}
	let i = index + 1;
	while (i < line.length) {
		if (line[i] === '\\') {
			i += 2;
			continue;
		}
		if (line[i] === quote) {
			return i + 1 - index;
		}
		i++;
	}
	return line.length - index;
}
