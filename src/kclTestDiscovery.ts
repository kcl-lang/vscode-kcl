// Copyright The KCL Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Discover KCL unit tests and build the `kcl test` invocation for them.
 *
 * A test suite is a `*_test.k` file whose name does not start with `_`.
 * A test case is a top-level `test_* = lambda` assignment. That matches
 * `kcl test` and the `kcl.runTest` code lens the language server emits.
 *
 * `kcl test --run` filters with an unanchored regular expression
 * (`Regex::is_match`), so a single test is selected with `^name$`.
 */

import * as path from 'path';

/** Client command the language server puts on a "run test" code lens. */
export const RUN_TEST_COMMAND = 'kcl.runTest';

/** Run every `test_*` lambda in the current suite file. */
export const RUN_FILE_TESTS_COMMAND = 'kcl.runTestsInFile';

const TEST_NAME = /^test_[A-Za-z0-9_]*$/;
const TEST_ASSIGN = /^(test_[A-Za-z0-9_]*)\s*=\s*lambda\b/;

export interface TestCase {
	name: string;
	/** 0-based line of the `test_* = lambda` assignment. */
	startLine: number;
	/** 0-based column where the name starts. Top-level cases start at 0. */
	nameStart: number;
	/** 0-based column where the name ends. */
	nameEnd: number;
	/** 0-based line of the last line of the case, inclusive. */
	endLine: number;
}

export interface TextSelection {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
	/** Selected text. Empty when the selection is a cursor. */
	text: string;
}

export interface TestRunPlan {
	cwd: string;
	/** Arguments after the `kcl` binary, e.g. `['test', '.', '--run', '^test_a$']`. */
	args: string[];
	title: string;
	names: string[];
}

export type TestPlanResult =
	| { ok: true; plan: TestRunPlan }
	| { ok: false; message: string };

interface OpenCase {
	name: string;
	nameEnd: number;
	startLine: number;
	endLine: number;
	phase: 'seek' | 'body';
	sigDepth: number;
	bodyDepth: number;
	seekFrom: number;
	/** Previous significant character while looking for the lambda body. */
	lastSig: string;
}

export function isTestName(name: string): boolean {
	return TEST_NAME.test(name);
}

/** `kcl test` loads `*_test.k` files and skips names that start with `_`. */
export function isKclTestFile(filePath: string): boolean {
	const base = path.basename(filePath);
	return base.endsWith('_test.k') && !base.startsWith('_');
}

export function findTestCases(source: string): TestCase[] {
	const lines = source.split(/\r?\n/);
	const cases: TestCase[] = [];
	let depth = 0;
	let triple: '"' | "'" | null = null;
	let open: OpenCase | null = null;

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		if (open && open.phase === 'seek' && lineNo !== open.startLine && isNewTopLevelStatement(line)) {
			open.endLine = lineNo - 1;
			cases.push(toCase(open));
			open = null;
		}
		if (!open && depth === 0 && !triple) {
			const matched = TEST_ASSIGN.exec(line);
			if (matched) {
				open = {
					name: matched[1],
					nameEnd: matched[1].length,
					startLine: lineNo,
					endLine: lineNo,
					phase: 'seek',
					sigDepth: 0,
					bodyDepth: 0,
					seekFrom: matched[0].length,
					lastSig: 'a',
				};
			}
		}

		const scanned = scanLine(line, lineNo, {
			depth,
			triple,
			open,
			startAt: open && open.startLine === lineNo && open.phase === 'seek' ? open.seekFrom : 0,
		});
		depth = scanned.depth;
		triple = scanned.triple;
		if (scanned.closed) {
			cases.push(scanned.closed);
		}
		open = scanned.open;
		if (open) {
			open.endLine = lineNo;
		}
	}

	if (open) {
		cases.push(toCase(open));
	}
	return cases;
}

export function resolveTestCases(cases: TestCase[], selection: TextSelection): TestCase[] {
	const selected = selection.text.trim();
	if (selected) {
		const named = cases.find((testCase) => testCase.name === selected && intersects(selection, nameRange(testCase)));
		if (named) {
			return [named];
		}
	}
	return cases.filter((testCase) => intersects(selection, caseRange(testCase)));
}

/** Anchored `--run` pattern. `--run` is an unanchored regex, so anchors select one name. */
export function runPattern(names: string[]): string {
	const unique = [...new Set(names)];
	const parts = unique.map(escapeRegExp);
	if (parts.length === 1) {
		return `^${parts[0]}$`;
	}
	return `^(?:${parts.join('|')})$`;
}

export function planNamedTest(filePath: string, name: string): TestPlanResult {
	const fileError = testFileError(filePath);
	if (fileError) {
		return fileError;
	}
	if (!isTestName(name)) {
		return { ok: false, message: `Not a KCL test name: ${name}` };
	}
	return { ok: true, plan: planFor(filePath, [name]) };
}

export function planCursorTest(filePath: string, source: string, selection: TextSelection): TestPlanResult {
	const fileError = testFileError(filePath);
	if (fileError) {
		return fileError;
	}
	const names = resolveTestCases(findTestCases(source), selection).map((testCase) => testCase.name);
	if (names.length === 0) {
		return {
			ok: false,
			message: 'No KCL test at the cursor. Place the cursor inside a test_* lambda, or select a test name.',
		};
	}
	return { ok: true, plan: planFor(filePath, names) };
}

export function planFileTests(filePath: string, source: string): TestPlanResult {
	const fileError = testFileError(filePath);
	if (fileError) {
		return fileError;
	}
	const names = findTestCases(source).map((testCase) => testCase.name);
	if (names.length === 0) {
		return { ok: false, message: `No test_* lambdas in ${path.basename(filePath)}.` };
	}
	return { ok: true, plan: planFor(filePath, names) };
}

function planFor(filePath: string, names: string[]): TestRunPlan {
	const unique = [...new Set(names)];
	const base = path.basename(filePath);
	return {
		cwd: path.dirname(filePath),
		args: ['test', '.', '--run', runPattern(unique)],
		title: unique.length === 1 ? `test ${unique[0]}` : `test ${base}`,
		names: unique,
	};
}

function testFileError(filePath: string): TestPlanResult | undefined {
	if (!isKclTestFile(filePath)) {
		return { ok: false, message: 'KCL unit tests are test_* lambdas in a *_test.k file.' };
	}
	return undefined;
}

function toCase(open: OpenCase): TestCase {
	return {
		name: open.name,
		startLine: open.startLine,
		nameStart: 0,
		nameEnd: open.nameEnd,
		endLine: open.endLine,
	};
}

function nameRange(testCase: TestCase): TextSelection {
	return {
		startLine: testCase.startLine,
		startCharacter: testCase.nameStart,
		endLine: testCase.startLine,
		endCharacter: testCase.nameEnd,
		text: testCase.name,
	};
}

function caseRange(testCase: TestCase): TextSelection {
	return {
		startLine: testCase.startLine,
		startCharacter: 0,
		endLine: testCase.endLine,
		endCharacter: Number.MAX_SAFE_INTEGER,
		text: '',
	};
}

/**
 * A column-0 statement ends a lambda signature that has not opened its body.
 * Indented lines and signature continuations (`{`, `|`, `->`, ...) stay with it.
 */
function isNewTopLevelStatement(line: string): boolean {
	if (line.length === 0 || line[0] === ' ' || line[0] === '\t' || line[0] === '#') {
		return false;
	}
	return !/^[{([|:,\-}\])]/.test(line);
}

function isTypeIntroducer(ch: string): boolean {
	return ch === ':' || ch === '|' || ch === ',' || ch === '>' || ch === '&';
}

interface ScanInput {
	depth: number;
	triple: '"' | "'" | null;
	open: OpenCase | null;
	startAt: number;
}

interface ScanOutput {
	depth: number;
	triple: '"' | "'" | null;
	open: OpenCase | null;
	closed: TestCase | null;
}

function scanLine(line: string, lineNo: number, input: ScanInput): ScanOutput {
	let depth = input.depth;
	let triple = input.triple;
	let open = input.open;
	let closed: TestCase | null = null;
	let i = input.startAt;

	while (i < line.length) {
		const ch = line[i];
		if (triple) {
			if (line.startsWith(triple + triple + triple, i)) {
				triple = null;
				i += 3;
				continue;
			}
			i++;
			continue;
		}
		if (ch === '#') {
			break;
		}
		if ((ch === '"' || ch === "'") && line.startsWith(ch + ch + ch, i)) {
			triple = ch;
			i += 3;
			continue;
		}
		if (ch === '"' || ch === "'") {
			i = skipString(line, i, ch);
			if (open && open.phase === 'seek') {
				open.lastSig = ch;
			}
			continue;
		}

		if (open && open.phase === 'seek') {
			if (ch === '{' && open.sigDepth === 0 && !isTypeIntroducer(open.lastSig)) {
				open.phase = 'body';
				open.bodyDepth = 1;
			} else if (ch === '{' || ch === '(' || ch === '[') {
				open.sigDepth++;
			} else if (ch === '}' || ch === ')' || ch === ']') {
				open.sigDepth = Math.max(0, open.sigDepth - 1);
			}
			if (ch !== ' ' && ch !== '\t') {
				open.lastSig = ch;
			}
		} else if (open && open.phase === 'body') {
			if (ch === '{') {
				open.bodyDepth++;
			} else if (ch === '}') {
				open.bodyDepth--;
				if (open.bodyDepth === 0) {
					open.endLine = lineNo;
					closed = toCase(open);
					open = null;
				}
			}
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth = Math.max(0, depth - 1);
		}
		i++;
	}

	return { depth, triple, open, closed };
}

function skipString(line: string, start: number, quote: string): number {
	let i = start + 1;
	while (i < line.length) {
		if (line[i] === '\\') {
			i += 2;
			continue;
		}
		if (line[i] === quote) {
			return i + 1;
		}
		i++;
	}
	return line.length;
}

function intersects(selection: TextSelection, target: TextSelection): boolean {
	const cursor = selection.startLine === selection.endLine
		&& selection.startCharacter === selection.endCharacter;
	if (cursor) {
		if (selection.startLine < target.startLine || selection.startLine > target.endLine) {
			return false;
		}
		if (selection.startLine === target.startLine && selection.startCharacter < target.startCharacter) {
			return false;
		}
		if (selection.startLine === target.endLine && selection.startCharacter > target.endCharacter) {
			return false;
		}
		return true;
	}

	let endLine = selection.endLine;
	let endCharacter = selection.endCharacter;
	// A selection that ends at column 0 does not include that line.
	if (endCharacter === 0 && endLine > selection.startLine) {
		endLine -= 1;
		endCharacter = Number.MAX_SAFE_INTEGER;
	}
	if (endLine < selection.startLine) {
		return false;
	}

	const startsBeforeTargetEnds = selection.startLine < target.endLine
		|| (selection.startLine === target.endLine && selection.startCharacter <= target.endCharacter);
	const endsAfterTargetStarts = endLine > target.startLine
		|| (endLine === target.startLine && endCharacter >= target.startCharacter);
	return startsBeforeTargetEnds && endsAfterTargetStarts;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
