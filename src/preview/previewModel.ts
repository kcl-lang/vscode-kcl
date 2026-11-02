import * as path from 'path';
import {
	ExecResult,
	formatProcessDetail,
	isUsageError,
	looksLikeConfigError,
	stripAnsi,
} from './runKcl';

/** Shown on the disabled command and inside the preview when the config cannot run. */
export const FIX_ERRORS_MESSAGE = 'Fix the errors in this KCL configuration before previewing.';

export const KCL_INSTALL_URL = 'https://www.kcl-lang.io/docs/user_docs/getting-started/install';

/** Matches vscode.DiagnosticSeverity.Error. */
export const DIAGNOSTIC_ERROR = 0;

export type PreviewOutcome = 'loading' | 'ok' | 'invalid' | 'unavailable';

export interface PreviewBanner {
	tone: 'warning' | 'error' | 'info';
	text: string;
	action?: 'install-docs';
}

export interface PreviewView {
	phase: 'loading' | 'ready';
	outcome: PreviewOutcome;
	title: string;
	meta: string;
	updating: boolean;
	replaceBody: boolean;
	updateBanner: boolean;
	yaml: string;
	placeholder: string;
	banner: PreviewBanner | null;
	detail: string;
	canCopy: boolean;
}

export interface DiagnosticRef {
	scheme: string;
	fsPath: string;
	toString(): string;
}

interface DescribedTarget {
	title: string;
	meta: string;
}

export function configurationHasErrors(
	entryFiles: readonly string[],
	active: DiagnosticRef | undefined,
	collections: ReadonlyArray<readonly [DiagnosticRef, ReadonlyArray<{ severity?: number }>]>,
): boolean {
	const files = new Set(entryFiles.map(filePath => normalizePath(filePath)));
	const activeKey = active ? active.toString() : undefined;
	for (const [uri, diagnostics] of collections) {
		const inStack = uri.scheme === 'file' && files.has(normalizePath(uri.fsPath));
		const isActive = activeKey !== undefined && uri.toString() === activeKey;
		if (!inStack && !isActive) {
			continue;
		}
		for (const diagnostic of diagnostics) {
			if (diagnostic.severity === DIAGNOSTIC_ERROR) {
				return true;
			}
		}
	}
	return false;
}

export function blockedView(desc: DescribedTarget): PreviewView {
	return readyBase(desc, {
		outcome: 'invalid',
		banner: { tone: 'warning', text: FIX_ERRORS_MESSAGE },
	});
}

export function problemView(desc: DescribedTarget, problem: string): PreviewView {
	return readyBase(desc, {
		outcome: 'unavailable',
		banner: { tone: 'error', text: problem },
	});
}

export function internalErrorView(message: string): PreviewView {
	return readyBase({ title: 'KCL Preview', meta: '' }, {
		outcome: 'unavailable',
		banner: { tone: 'error', text: message },
	});
}

export function loadingView(desc: DescribedTarget, keepBody: boolean, canCopy: boolean): PreviewView {
	return {
		phase: 'loading',
		outcome: 'loading',
		title: desc.title,
		meta: keepBody ? desc.meta : 'Running KCL…',
		updating: keepBody,
		replaceBody: !keepBody,
		updateBanner: !keepBody,
		yaml: '',
		placeholder: keepBody ? '' : 'Running KCL…',
		banner: null,
		detail: '',
		canCopy,
	};
}

export function withUnsavedStackHint(view: PreviewView): PreviewView {
	if (view.outcome !== 'ok') {
		return view;
	}
	const extra = 'Unsaved changes are not included. Save the file to update this stack preview.';
	if (view.banner && view.banner.text.indexOf('Unsaved changes are not included') !== -1) {
		return view;
	}
	const text = view.banner ? `${view.banner.text} ${extra}` : extra;
	return {
		...view,
		replaceBody: false,
		updating: false,
		updateBanner: true,
		banner: { tone: 'info', text },
	};
}

export function resultView(desc: DescribedTarget, result: ExecResult, dirtyStack: boolean): PreviewView {
	if (result.error === 'cancelled') {
		return loadingView(desc, true, false);
	}
	if (result.error === 'not-found') {
		return readyBase(desc, {
			outcome: 'unavailable',
			banner: {
				tone: 'error',
				text: 'The kcl command was not found on PATH. Install KCL, then run the preview again. Reload the window if KCL was just installed.',
				action: 'install-docs',
			},
		});
	}
	if (result.error === 'timeout') {
		return readyBase(desc, {
			outcome: 'unavailable',
			banner: { tone: 'error', text: 'KCL run timed out before it produced a preview.' },
			detail: formatProcessDetail(result),
		});
	}
	if (result.error) {
		return readyBase(desc, {
			outcome: 'unavailable',
			banner: { tone: 'error', text: result.message || 'KCL could not be started.' },
			detail: formatProcessDetail(result),
		});
	}
	if (result.exitCode !== 0) {
		const detail = formatProcessDetail(result);
		if (isUsageError(result)) {
			return readyBase(desc, {
				outcome: 'unavailable',
				banner: {
					tone: 'error',
					text: 'This KCL CLI does not support the preview command. Update KCL and try again.',
				},
				detail,
			});
		}
		if (dirtyStack) {
			return readyBase(desc, {
				outcome: 'unavailable',
				banner: {
					tone: 'warning',
					text: 'The saved stack could not be previewed. Save this file to include unsaved edits.',
				},
				detail,
			});
		}
		if (detail.length === 0 || looksLikeConfigError(detail)) {
			return readyBase(desc, {
				outcome: 'invalid',
				banner: { tone: 'warning', text: FIX_ERRORS_MESSAGE },
				detail,
			});
		}
		return readyBase(desc, {
			outcome: 'unavailable',
			banner: { tone: 'error', text: 'KCL could not preview this configuration.' },
			detail,
		});
	}

	const yaml = stripAnsi(result.stdout).replace(/\s+$/, '');
	const notes: string[] = [];
	if (!yaml.trim()) {
		notes.push('KCL ran successfully and produced no YAML output.');
	}
	if (dirtyStack) {
		notes.push('Unsaved changes are not included. Save the file to update this stack preview.');
	}
	return readyBase(desc, {
		outcome: 'ok',
		yaml: yaml ? yaml + '\n' : '',
		canCopy: yaml.trim().length > 0,
		banner: notes.length ? { tone: 'info', text: notes.join(' ') } : null,
	});
}

function readyBase(desc: DescribedTarget, extra: Partial<PreviewView> & Pick<PreviewView, 'outcome'>): PreviewView {
	return {
		phase: 'ready',
		title: desc.title,
		meta: desc.meta,
		updating: false,
		replaceBody: true,
		updateBanner: true,
		yaml: '',
		placeholder: '',
		banner: null,
		detail: '',
		canCopy: false,
		...extra,
	};
}

function normalizePath(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
