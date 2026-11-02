import * as vscode from 'vscode';
import { outputChannel } from '../kclStatus';
import {
	FIX_ERRORS_MESSAGE,
	KCL_INSTALL_URL,
	PreviewView,
	blockedView,
	configurationHasErrors,
	internalErrorView,
	loadingView,
	problemView,
	resultView,
	withUnsavedStackHint,
} from './previewModel';
import { KclPreviewPanel, WebviewRequest } from './previewPanel';
import {
	PreviewDescription,
	describePreview,
	prepareRun,
	previewStorageKey,
} from './previewTarget';
import {
	KCL_RUN_TIMEOUT_MS,
	findKclBinary,
	runAttempts,
	startProcess,
} from './runKcl';

/**
 * Preview commands, editor affordances, and the live refresh loop.
 *
 * VS Code cannot grey out a command palette or toolbar item in place. When the
 * configuration has errors the real commands stay available to shortcuts, and
 * the palette, toolbar, and tab menu show a warning command that does not run
 * KCL. Shortcuts still open the panel with an empty body and the same warning.
 */
export function registerKclPreview(context: vscode.ExtensionContext): void {
	const controller = new PreviewController(context.extensionUri);
	context.subscriptions.push(controller);
	context.subscriptions.push(
		vscode.commands.registerCommand('kcl.openPreview', () => controller.open(false)),
		vscode.commands.registerCommand('kcl.openPreviewToSide', () => controller.open(true)),
		vscode.commands.registerCommand('kcl.previewUnavailable', () => controller.warnDisabled()),
		vscode.commands.registerCommand('kcl.previewToSideUnavailable', () => controller.warnDisabled()),
	);
}

class PreviewController implements vscode.Disposable {
	private readonly panel: KclPreviewPanel;
	private readonly failedKeys = new Set<string>();
	private tracked: vscode.TextDocument | undefined;
	private lastView: PreviewView | undefined;
	private currentRun: { cancel: () => void } | undefined;
	private runToken = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private contextInitialized = false;
	private contextBlocked = false;
	private disposed = false;
	private readonly listeners: vscode.Disposable[];

	constructor(extensionUri: vscode.Uri) {
		this.panel = new KclPreviewPanel(
			extensionUri,
			request => this.onWebviewRequest(request),
			() => this.onPanelDisposed(),
		);
		this.listeners = [
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.publishContext();
				const active = vscode.window.activeTextEditor?.document;
				if (this.panel.isOpen && active && active.languageId === 'KCL') {
					this.tracked = active;
					this.scheduleRefresh(150, false);
				}
			}),
			vscode.workspace.onDidChangeTextDocument(event => this.onDocumentChanged(event)),
			vscode.workspace.onDidSaveTextDocument(document => {
				if (document.languageId !== 'KCL' || !this.panel.isOpen) {
					return;
				}
				this.clearFailure(document);
				this.publishContext();
				this.scheduleRefresh(50, true);
			}),
			vscode.languages.onDidChangeDiagnostics(() => {
				const before = this.contextBlocked;
				this.publishContext();
				if (this.panel.isOpen && before !== this.contextBlocked) {
					this.scheduleRefresh(50, false);
				}
			}),
		];
		this.publishContext();
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.currentRun?.cancel();
		for (const listener of this.listeners) {
			listener.dispose();
		}
		this.panel.dispose();
	}

	open(side: boolean): void {
		const active = vscode.window.activeTextEditor?.document;
		if (!active || active.languageId !== 'KCL') {
			void vscode.window.showInformationMessage('Open a KCL file to preview its YAML output.');
			return;
		}
		this.tracked = active;
		const column = side ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
		this.panel.reveal(column, side);
		void this.refresh(false);
	}

	warnDisabled(): void {
		void vscode.window.showWarningMessage(FIX_ERRORS_MESSAGE);
	}

	private onPanelDisposed(): void {
		this.currentRun?.cancel();
		this.currentRun = undefined;
		this.runToken++;
	}

	private onWebviewRequest(request: WebviewRequest): void {
		if (request.type === 'refresh') {
			this.scheduleRefresh(0, true);
			return;
		}
		if (request.type === 'copy') {
			const yaml = this.lastView && this.lastView.canCopy ? this.lastView.yaml : '';
			if (!yaml) {
				return;
			}
			void vscode.env.clipboard.writeText(yaml);
			void vscode.window.setStatusBarMessage('Copied KCL preview', 2000);
			return;
		}
		if (request.type === 'open-docs') {
			void vscode.env.openExternal(vscode.Uri.parse(KCL_INSTALL_URL));
		}
	}

	private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
		if (event.document.languageId !== 'KCL') {
			return;
		}
		this.clearFailure(event.document);
		this.publishContext();
		if (!this.panel.isOpen) {
			return;
		}
		const current = this.currentDocument();
		if (!current || event.document.uri.toString() !== current.uri.toString()) {
			return;
		}
		const description = this.describe(event.document);
		if (description.kind === 'file') {
			this.scheduleRefresh(400, false);
			return;
		}
		if (event.document.isDirty && this.lastView && this.lastView.outcome === 'ok') {
			const hinted = withUnsavedStackHint(this.lastView);
			this.lastView = hinted;
			this.panel.post(hinted);
		}
	}

	private scheduleRefresh(delay: number, force: boolean): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.refresh(force);
		}, delay);
	}

	private async refresh(force: boolean): Promise<void> {
		if (this.disposed || !this.panel.isOpen) {
			return;
		}
		const document = this.currentDocument();
		if (!document) {
			return;
		}
		this.currentRun?.cancel();
		this.currentRun = undefined;
		const token = ++this.runToken;
		try {
			await this.refreshDocument(document, token, force);
		} catch (err) {
			if (token !== this.runToken || !this.panel.isOpen) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.show(internalErrorView(`KCL preview failed: ${message}`));
		}
	}

	private async refreshDocument(document: vscode.TextDocument, token: number, force: boolean): Promise<void> {
		const description = this.describe(document);
		const key = previewStorageKey(description, document.uri.toString());
		const diagnosticsBlocked = this.diagnosticsBlocked(document, description);

		if (diagnosticsBlocked) {
			this.publishContext();
			this.show(blockedView(description));
			return;
		}
		if (!force && this.failedKeys.has(key)) {
			if (this.lastView && this.lastView.outcome === 'invalid') {
				this.show(this.lastView);
			} else {
				this.show(blockedView(description));
			}
			return;
		}
		if (description.problem) {
			this.show(problemView(description, description.problem));
			return;
		}

		const keepBody = this.lastView?.outcome === 'ok';
		const canCopy = keepBody && this.lastView ? this.lastView.canCopy : false;
		this.panel.post(loadingView(description, keepBody, canCopy));

		const prepared = prepareRun(description, document.getText());
		try {
			const binary = findKclBinary();
			if (!binary) {
				this.show(resultView(description, {
					exitCode: null,
					stdout: '',
					stderr: '',
					error: 'not-found',
				}, false));
				return;
			}
			const result = await runAttempts(prepared.attempts, async args => {
				if (token !== this.runToken) {
					return { exitCode: null, stdout: '', stderr: '', error: 'cancelled' as const };
				}
				outputChannel.appendLine(`[preview] ${binary} ${args.map(quoteArg).join(' ')}`);
				const running = startProcess(binary, args, prepared.cwd, KCL_RUN_TIMEOUT_MS);
				this.currentRun = running;
				const attempt = await running.result;
				if (this.currentRun === running) {
					this.currentRun = undefined;
				}
				return attempt;
			});
			if (token !== this.runToken || !this.panel.isOpen || result.error === 'cancelled') {
				return;
			}
			outputChannel.appendLine(`[preview] ${result.error ? result.error : 'exit ' + result.exitCode}`);
			const dirtyStack = description.kind === 'stack' && document.isDirty;
			const view = resultView(description, result, dirtyStack);
			if (view.outcome === 'invalid') {
				this.failedKeys.add(key);
			} else if (view.outcome === 'ok') {
				this.failedKeys.delete(key);
			}
			this.publishContext();
			this.show(view);
		} finally {
			prepared.dispose();
		}
	}

	private show(view: PreviewView): void {
		if (view.outcome !== 'loading') {
			this.lastView = view;
		}
		this.panel.post(view);
	}

	private currentDocument(): vscode.TextDocument | undefined {
		const active = vscode.window.activeTextEditor?.document;
		if (active && active.languageId === 'KCL') {
			this.tracked = active;
			return active;
		}
		if (this.tracked && this.tracked.languageId === 'KCL') {
			return this.tracked;
		}
		return undefined;
	}

	private describe(document: vscode.TextDocument): PreviewDescription {
		return describePreview({
			scheme: document.uri.scheme,
			fsPath: document.uri.scheme === 'file' ? document.uri.fsPath : undefined,
			workspaceRoot: workspaceRootFor(document),
			isDirty: document.isDirty,
		});
	}

	private diagnosticsBlocked(document: vscode.TextDocument, description: PreviewDescription): boolean {
		return configurationHasErrors(
			description.entryFiles,
			document.uri,
			vscode.languages.getDiagnostics(),
		);
	}

	private clearFailure(document: vscode.TextDocument): void {
		const description = this.describe(document);
		this.failedKeys.delete(previewStorageKey(description, document.uri.toString()));
	}

	private publishContext(): void {
		const active = vscode.window.activeTextEditor?.document;
		if (!active || active.languageId !== 'KCL') {
			this.setHasErrors(false);
			return;
		}
		this.setHasErrors(this.isBlocked(active));
	}

	private isBlocked(document: vscode.TextDocument): boolean {
		const description = this.describe(document);
		if (this.diagnosticsBlocked(document, description)) {
			return true;
		}
		return this.failedKeys.has(previewStorageKey(description, document.uri.toString()));
	}

	private setHasErrors(value: boolean): void {
		if (this.contextInitialized && this.contextBlocked === value) {
			return;
		}
		this.contextInitialized = true;
		this.contextBlocked = value;
		void vscode.commands.executeCommand('setContext', 'kcl.previewHasErrors', value);
	}
}

function workspaceRootFor(document: vscode.TextDocument): string | undefined {
	if (document.uri.scheme === 'file') {
		return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
	}
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function quoteArg(arg: string): string {
	if (/[\s"]/.test(arg)) {
		return `"${arg.replace(/"/g, '\\"')}"`;
	}
	return arg;
}
