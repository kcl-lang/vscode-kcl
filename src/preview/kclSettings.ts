/**
 * Reads the small subset of a KCL settings file (kcl.yaml) that preview needs:
 * the main-package entry list and whether a run would write an output file.
 */

export interface SettingsInspection {
	/** Paths as written in the file. Undefined when neither `file` nor `files` is set. */
	entryFiles?: string[];
	/** True when `kcl_cli_configs.output` is set. Preview must not honor that write. */
	writesOutput: boolean;
}

interface Scan {
	entryFiles?: string[];
	drop: Set<number>;
	newline: '\n' | '\r\n';
}

export function inspectSettings(text: string): SettingsInspection {
	const scan = scanSettings(text);
	return {
		entryFiles: scan.entryFiles,
		writesOutput: scan.drop.size > 0,
	};
}

/**
 * Returns the settings text with `kcl_cli_configs.output` removed so a preview
 * run cannot overwrite a golden file configured for CI.
 */
export function stripSettingsOutput(text: string): { text: string; changed: boolean } {
	const scan = scanSettings(text);
	if (scan.drop.size === 0) {
		return { text, changed: false };
	}
	const lines = text.split(/\r?\n/);
	const kept = lines.filter((_, index) => !scan.drop.has(index));
	return { text: kept.join(scan.newline), changed: true };
}

function scanSettings(text: string): Scan {
	const newline = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const drop = new Set<number>();
	let entryFiles: string[] | undefined;
	let mode: 'root' | 'configs' | 'entries' = 'root';
	let configsIndent = -1;
	let entriesIndent = -1;

	for (let i = 0; i < lines.length; i++) {
		const info = lineInfo(lines[i]);
		if (info.ignore) {
			continue;
		}

		if (mode === 'entries' && info.indent <= entriesIndent) {
			mode = 'configs';
		}
		if (mode === 'configs' && info.indent <= configsIndent) {
			mode = 'root';
		}

		if (mode === 'root') {
			if (/^kcl_cli_configs\s*:/.test(info.trimmed)) {
				mode = 'configs';
				configsIndent = info.indent;
			}
			continue;
		}

		if (mode === 'entries') {
			const item = info.trimmed.match(/^-\s+(.+)$/);
			if (item) {
				const value = unquoteScalar(stripComment(item[1]));
				if (value) {
					if (!entryFiles) {
						entryFiles = [];
					}
					entryFiles.push(value);
				}
			}
			continue;
		}

		const files = info.trimmed.match(/^(?:files|file)\s*:\s*(.*)$/);
		if (files) {
			if (!entryFiles) {
				entryFiles = [];
			}
			const rest = files[1].trim();
			if (!rest || rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
				mode = 'entries';
				entriesIndent = info.indent;
			} else if (rest.startsWith('[')) {
				for (const part of splitFlowList(rest)) {
					const value = unquoteScalar(stripComment(part));
					if (value) {
						entryFiles.push(value);
					}
				}
			} else {
				const value = unquoteScalar(stripComment(rest));
				if (value) {
					entryFiles.push(value);
				}
			}
			continue;
		}

		if (/^output\s*:/.test(info.trimmed)) {
			drop.add(i);
			const outputIndent = info.indent;
			let j = i + 1;
			while (j < lines.length) {
				const next = lineInfo(lines[j]);
				if (next.ignore) {
					let k = j + 1;
					while (k < lines.length && lineInfo(lines[k]).ignore) {
						k++;
					}
					if (k >= lines.length || lineInfo(lines[k]).indent <= outputIndent) {
						break;
					}
					drop.add(j);
					j++;
					continue;
				}
				if (next.indent > outputIndent) {
					drop.add(j);
					j++;
					continue;
				}
				break;
			}
			i = j - 1;
		}
	}

	return { entryFiles, drop, newline };
}

function lineInfo(raw: string): { indent: number; trimmed: string; ignore: boolean } {
	const expanded = raw.replace(/\t/g, '    ');
	const trimmed = expanded.trim();
	const ignore = trimmed.length === 0 || trimmed.startsWith('#');
	const indent = ignore ? 0 : expanded.length - expanded.trimStart().length;
	return { indent, trimmed, ignore };
}

function stripComment(value: string): string {
	let single = false;
	let double = false;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "'" && !double) {
			single = !single;
		} else if (ch === '"' && !single) {
			double = !double;
		} else if (ch === '#' && !single && !double) {
			return value.slice(0, i).trim();
		}
	}
	return value.trim();
}

function unquoteScalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const quote = trimmed[0];
		if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function splitFlowList(rest: string): string[] {
	const inner = rest.replace(/^\[/, '').replace(/\][\s\S]*$/, '');
	const parts: string[] = [];
	let current = '';
	let single = false;
	let double = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "'" && !double) {
			single = !single;
		} else if (ch === '"' && !single) {
			double = !double;
		} else if (ch === ',' && !single && !double) {
			parts.push(current.trim());
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim()) {
		parts.push(current.trim());
	}
	return parts;
}
