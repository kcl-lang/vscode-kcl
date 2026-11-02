import { spawn, ChildProcess } from 'child_process';
import * as shelljs from 'shelljs';

export const KCL_RUN_TIMEOUT_MS = 60000;
const MAX_OUTPUT_CHARS = 500000;

export interface ExecResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: 'not-found' | 'timeout' | 'spawn' | 'cancelled';
	message?: string;
}

export interface RunningCommand {
	result: Promise<ExecResult>;
	cancel: () => void;
}

export function findKclBinary(): string | undefined {
	const found = shelljs.which('kcl');
	if (!found) {
		return undefined;
	}
	const value = found.toString().trim();
	return value ? value : undefined;
}

/**
 * Attempts from newest CLI to the pre-`run` CLI. Callers stop early unless the
 * failure is "this flag/command does not exist".
 */
export function kclRunAttempts(target: { filePath?: string; settingsPath?: string }): string[][] {
	if (target.filePath) {
		return [
			['run', target.filePath, '--format', 'yaml', '--no_style'],
			['run', target.filePath],
			[target.filePath],
		];
	}
	if (target.settingsPath) {
		return [
			['run', '-Y', target.settingsPath, '--format', 'yaml', '--no_style'],
			['run', '-Y', target.settingsPath],
			['-Y', target.settingsPath],
		];
	}
	// A bare `kcl` with no args can start a REPL. Never do that.
	return [
		['run', '--format', 'yaml', '--no_style'],
		['run'],
	];
}

export function isUsageError(result: ExecResult): boolean {
	if (result.error || result.exitCode === 0) {
		return false;
	}
	const text = `${result.stderr}\n${result.stdout}`;
	return /unknown flag|unknown command|unrecognized|unexpected argument|flag provided but not defined|invalid option|unknown shorthand flag/i.test(text);
}

export function looksLikeConfigError(text: string): boolean {
	return /error\s*\[/i.test(text)
		|| /syntax error/i.test(text)
		|| /failed to compile/i.test(text)
		|| /check failed/i.test(text)
		|| /evaluation error/i.test(text)
		|| /(^|\n)\s*error:/i.test(text);
}

export function stripAnsi(text: string): string {
	// CSI sequences. Built as a string so the pattern does not embed a raw ESC.
	const csi = new RegExp(String.fromCharCode(27) + '\\[[0-?]*[ -/]*[@-~]', 'g');
	return text.replace(csi, '');
}

export function formatProcessDetail(result: ExecResult): string {
	const chunks = [result.stderr, result.stdout].filter(part => part && part.trim());
	const text = stripAnsi(chunks.join('\n\n')).trim();
	if (text.length <= MAX_OUTPUT_CHARS) {
		return text;
	}
	return text.slice(0, MAX_OUTPUT_CHARS) + '\n…';
}

export async function runAttempts(
	attempts: string[][],
	start: (args: string[]) => Promise<ExecResult>,
): Promise<ExecResult> {
	let last: ExecResult = {
		exitCode: null,
		stdout: '',
		stderr: '',
		error: 'spawn',
		message: 'No KCL command was produced for this file.',
	};
	for (let i = 0; i < attempts.length; i++) {
		last = await start(attempts[i]);
		if (last.error === 'cancelled') {
			return last;
		}
		if (i === attempts.length - 1 || !isUsageError(last)) {
			return last;
		}
	}
	return last;
}

export function startProcess(command: string, args: string[], cwd: string, timeoutMs: number): RunningCommand {
	let cancel = () => { /* replaced once the process is armed */ };
	const result = new Promise<ExecResult>(resolve => {
		let settled = false;
		let child: ChildProcess | undefined;
		const stdout: string[] = [];
		const stderr: string[] = [];
		let stdoutChars = 0;
		let stderrChars = 0;

		const finish = (value: ExecResult) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};

		const collect = (bucket: string[], current: number, chunk: Buffer): number => {
			if (current >= MAX_OUTPUT_CHARS) {
				return current;
			}
			const text = chunk.toString('utf8');
			const room = MAX_OUTPUT_CHARS - current;
			bucket.push(text.length > room ? text.slice(0, room) : text);
			return current + Math.min(text.length, room);
		};

		try {
			child = spawn(command, args, { cwd, env: process.env, windowsHide: true });
		} catch (err) {
			finish({
				exitCode: null,
				stdout: '',
				stderr: '',
				error: 'spawn',
				message: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		const timer = setTimeout(() => {
			if (child) {
				child.kill();
			}
			finish({
				exitCode: null,
				stdout: stdout.join(''),
				stderr: stderr.join(''),
				error: 'timeout',
			});
		}, timeoutMs);

		cancel = () => {
			if (child && child.exitCode === null && !child.killed) {
				child.kill();
			}
			finish({ exitCode: null, stdout: '', stderr: '', error: 'cancelled' });
		};

		child.on('error', (err: NodeJS.ErrnoException) => {
			finish({
				exitCode: null,
				stdout: stdout.join(''),
				stderr: stderr.join(''),
				error: err.code === 'ENOENT' ? 'not-found' : 'spawn',
				message: err.message,
			});
		});
		child.stdout?.on('data', (chunk: Buffer) => {
			stdoutChars = collect(stdout, stdoutChars, chunk);
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderrChars = collect(stderr, stderrChars, chunk);
		});
		child.on('close', code => {
			finish({
				exitCode: code,
				stdout: stdout.join(''),
				stderr: stderr.join(''),
			});
		});
	});

	return { result, cancel };
}
