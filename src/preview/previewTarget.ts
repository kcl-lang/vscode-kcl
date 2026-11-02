import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectSettings, stripSettingsOutput } from './kclSettings';
import { kclRunAttempts } from './runKcl';

export interface PreviewDescription {
	kind: 'file' | 'stack';
	cwd: string;
	filePath?: string;
	settingsPath?: string;
	stackRoot?: string;
	entryFiles: string[];
	title: string;
	meta: string;
	/** Set when the stack settings file exists but cannot be read. */
	problem?: string;
	/** Run the editor buffer instead of the file on disk. */
	useBuffer: boolean;
}

export interface PreparedRun {
	cwd: string;
	attempts: string[][];
	dispose: () => void;
}

export function pathKey(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function previewStorageKey(desc: PreviewDescription, uriKey: string): string {
	if (desc.kind === 'stack' && desc.stackRoot) {
		return 'stack:' + pathKey(desc.stackRoot);
	}
	return 'file:' + uriKey;
}

export function describePreview(input: {
	scheme: string;
	fsPath?: string;
	workspaceRoot?: string;
	isDirty: boolean;
}): PreviewDescription {
	if (input.scheme !== 'file' || !input.fsPath) {
		const cwd = input.workspaceRoot && fs.existsSync(input.workspaceRoot)
			? input.workspaceRoot
			: os.tmpdir();
		return {
			kind: 'file',
			cwd,
			entryFiles: [],
			title: 'KCL Preview',
			meta: 'Single file · untitled.k',
			useBuffer: true,
		};
	}

	const filePath = path.resolve(input.fsPath);
	const stack = findStack(filePath, input.workspaceRoot);
	if (!stack) {
		return {
			kind: 'file',
			cwd: path.dirname(filePath),
			filePath,
			entryFiles: [filePath],
			title: `Preview ${path.basename(filePath)}`,
			meta: `Single file · ${path.basename(filePath)}`,
			useBuffer: input.isDirty,
		};
	}

	const marker = stack.settingsPath ? 'kcl.yaml' : 'kcl.mod';
	let entryFiles = [filePath];
	let problem: string | undefined;
	if (stack.settingsPath) {
		try {
			const text = fs.readFileSync(stack.settingsPath, 'utf8');
			const inspected = inspectSettings(text);
			if (inspected.entryFiles && inspected.entryFiles.length > 0) {
				entryFiles = uniquePaths([
					...inspected.entryFiles.map(rel => path.resolve(stack.root, rel)),
					filePath,
				]);
			} else {
				entryFiles = uniquePaths([...listKFiles(stack.root), filePath]);
			}
		} catch (err) {
			problem = `Could not read ${stack.settingsPath}: ${errorMessage(err)}`;
			entryFiles = uniquePaths([...listKFiles(stack.root), filePath]);
		}
	} else {
		entryFiles = uniquePaths([...listKFiles(stack.root), filePath]);
	}

	return {
		kind: 'stack',
		cwd: stack.root,
		settingsPath: stack.settingsPath,
		stackRoot: stack.root,
		entryFiles,
		title: 'KCL Stack Preview',
		meta: `Stack · ${path.basename(stack.root)}/${marker}`,
		problem,
		useBuffer: false,
	};
}

export function prepareRun(desc: PreviewDescription, documentText: string): PreparedRun {
	const created: string[] = [];
	const dispose = () => {
		for (let i = created.length - 1; i >= 0; i--) {
			try {
				fs.rmSync(created[i], { recursive: true, force: true });
			} catch {
				// Best-effort cleanup of preview temp files.
			}
		}
	};

	try {
		if (desc.kind === 'file') {
			let filePath = desc.filePath;
			if (desc.useBuffer || !filePath) {
				filePath = writeBufferCopy(desc.filePath, documentText, created);
			}
			return {
				cwd: desc.cwd,
				attempts: kclRunAttempts({ filePath }),
				dispose,
			};
		}

		let settingsPath = desc.settingsPath;
		if (settingsPath) {
			const original = fs.readFileSync(settingsPath, 'utf8');
			const stripped = stripSettingsOutput(original);
			if (stripped.changed) {
				const tempPath = path.join(
					path.dirname(settingsPath),
					`.kcl-preview-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.yaml`,
				);
				fs.writeFileSync(tempPath, stripped.text, 'utf8');
				created.push(tempPath);
				settingsPath = tempPath;
			}
		}
		return {
			cwd: desc.cwd,
			attempts: kclRunAttempts({ settingsPath }),
			dispose,
		};
	} catch (err) {
		dispose();
		throw err;
	}
}

function writeBufferCopy(filePath: string | undefined, documentText: string, created: string[]): string {
	const base = filePath ? path.basename(filePath) : 'main.k';
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcl-preview-'));
	created.push(dir);
	const tempPath = path.join(dir, base.endsWith('.k') ? base : 'main.k');
	fs.writeFileSync(tempPath, documentText, 'utf8');
	return tempPath;
}

interface StackHit {
	root: string;
	settingsPath?: string;
}

function findStack(filePath: string, workspaceRoot?: string): StackHit | undefined {
	let dir = path.resolve(path.dirname(filePath));
	const boundary = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
	const bounded = boundary !== undefined && isInside(boundary, dir);

	for (let depth = 0; depth < 40; depth++) {
		if (bounded && boundary && !isInside(boundary, dir)) {
			break;
		}
		const settings = path.join(dir, 'kcl.yaml');
		const mod = path.join(dir, 'kcl.mod');
		const hasSettings = fs.existsSync(settings);
		const hasMod = fs.existsSync(mod);
		if (hasSettings || hasMod) {
			return {
				root: dir,
				settingsPath: hasSettings ? settings : undefined,
			};
		}
		if (bounded && boundary && pathsEqual(dir, boundary)) {
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}

function listKFiles(dir: string): string[] {
	let names: string[] = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const name of names) {
		if (name.startsWith('.')) {
			continue;
		}
		if (!name.endsWith('.k')) {
			continue;
		}
		files.push(path.join(dir, name));
	}
	files.sort();
	return files;
}

function uniquePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const filePath of paths) {
		const key = pathKey(filePath);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(path.resolve(filePath));
	}
	return unique;
}

function isInside(parent: string, child: string): boolean {
	const rel = path.relative(pathKey(parent), pathKey(child));
	return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function pathsEqual(left: string, right: string): boolean {
	return pathKey(left) === pathKey(right);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
