import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import type { PreviewView } from './previewModel';

export type WebviewRequest =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'copy' }
	| { type: 'open-docs' };

/**
 * One KCL preview panel. Re-shown in place for both the single and side layouts.
 */
export class KclPreviewPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private lastView: PreviewView | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly onRequest: (request: WebviewRequest) => void,
		private readonly onDisposed: () => void,
	) {}

	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	reveal(column: vscode.ViewColumn, preserveFocus: boolean): void {
		if (this.panel) {
			this.panel.reveal(column, preserveFocus);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'kcl.dataPreview',
			'KCL Preview',
			{ viewColumn: column, preserveFocus },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);
		panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'kcl-logo.png');
		panel.webview.html = previewHtml(randomBytes(16).toString('hex'));
		this.disposables.push(panel.onDidDispose(() => {
			this.panel = undefined;
			this.onDisposed();
		}));
		this.disposables.push(panel.webview.onDidReceiveMessage(message => {
			if (!isWebviewRequest(message)) {
				return;
			}
			if (message.type === 'ready') {
				this.flush();
				return;
			}
			this.onRequest(message);
		}));
		this.panel = panel;
		this.flush();
	}

	post(view: PreviewView): void {
		this.lastView = view;
		if (this.panel) {
			this.panel.title = view.title || 'KCL Preview';
		}
		this.flush();
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	private flush(): void {
		if (!this.panel || !this.lastView) {
			return;
		}
		void this.panel.webview.postMessage(this.lastView);
	}
}

function isWebviewRequest(value: unknown): value is WebviewRequest {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return type === 'ready' || type === 'refresh' || type === 'copy' || type === 'open-docs';
}

function previewHtml(nonce: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KCL Preview</title>
<style>
	body {
		margin: 0;
		color: var(--vscode-editor-foreground);
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size, 13px);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		position: sticky;
		top: 0;
		background: var(--vscode-editor-background);
		border-bottom: 1px solid var(--vscode-panel-border, transparent);
		z-index: 1;
	}
	#title { font-weight: 600; }
	#meta {
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		margin-top: 2px;
	}
	.actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
	#updating { color: var(--vscode-descriptionForeground); font-size: 12px; }
	button {
		font-family: var(--vscode-font-family);
		font-size: 12px;
		border: none;
		padding: 4px 10px;
		border-radius: 2px;
		cursor: pointer;
	}
	button.primary {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}
	button.secondary {
		color: var(--vscode-button-secondaryForeground);
		background: var(--vscode-button-secondaryBackground);
	}
	button:disabled { opacity: 0.45; cursor: default; }
	.banner {
		margin: 12px 16px 0;
		padding: 8px 10px;
		border-radius: 4px;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.banner.warning {
		background: var(--vscode-inputValidation-warningBackground);
		border: 1px solid var(--vscode-inputValidation-warningBorder);
	}
	.banner.error {
		background: var(--vscode-inputValidation-errorBackground);
		border: 1px solid var(--vscode-inputValidation-errorBorder);
	}
	.banner.info {
		background: var(--vscode-textBlockQuote-background);
		border: 1px solid var(--vscode-textBlockQuote-border, transparent);
	}
	pre {
		margin: 0;
		padding: 12px 16px 24px;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--vscode-editor-font-size, 13px);
		line-height: 1.45;
		tab-size: 2;
		white-space: pre;
		overflow: auto;
	}
	.placeholder { color: var(--vscode-descriptionForeground); }
	.detail-label {
		padding: 4px 16px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
	}
	#detail { color: var(--vscode-descriptionForeground); padding-top: 4px; }
	.tok-key { color: var(--vscode-symbolIcon-fieldForeground, #9cdcfe); }
	.tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
	.tok-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
	.tok-bool { color: var(--vscode-debugTokenExpression-boolean, #569cd6); }
	.tok-comment { color: var(--vscode-descriptionForeground); }
	.tok-punct { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
	<header>
		<div>
			<div id="title">KCL Preview</div>
			<div id="meta"></div>
		</div>
		<div class="actions">
			<span id="updating" hidden>Updating…</span>
			<button id="copy" class="secondary" type="button" disabled>Copy</button>
			<button id="refresh" class="primary" type="button">Refresh</button>
		</div>
	</header>
	<div id="banner" class="banner" role="status" hidden>
		<span id="banner-text"></span>
		<button id="banner-action" class="secondary" type="button" hidden>Open install guide</button>
	</div>
	<pre id="output" aria-label="YAML preview"></pre>
	<section id="detail-wrap" hidden>
		<div class="detail-label">KCL output</div>
		<pre id="detail"></pre>
	</section>
	<script nonce="${nonce}">
		var vscodeApi = acquireVsCodeApi();
		var currentYaml = '';
		var output = document.getElementById('output');
		var banner = document.getElementById('banner');
		var bannerText = document.getElementById('banner-text');
		var bannerAction = document.getElementById('banner-action');
		var detailWrap = document.getElementById('detail-wrap');
		var detail = document.getElementById('detail');

		document.getElementById('refresh').addEventListener('click', function () {
			vscodeApi.postMessage({ type: 'refresh' });
		});
		document.getElementById('copy').addEventListener('click', function () {
			vscodeApi.postMessage({ type: 'copy' });
		});
		bannerAction.addEventListener('click', function () {
			vscodeApi.postMessage({ type: 'open-docs' });
		});
		window.addEventListener('message', function (event) {
			render(event.data || {});
		});

		function render(msg) {
			document.getElementById('title').textContent = msg.title || 'KCL Preview';
			document.getElementById('meta').textContent = msg.meta || '';
			document.getElementById('updating').hidden = !msg.updating;
			document.getElementById('copy').disabled = !msg.canCopy;
			if (msg.updateBanner) {
				if (msg.banner && msg.banner.text) {
					banner.hidden = false;
					banner.className = 'banner ' + (msg.banner.tone || 'info');
					bannerText.textContent = msg.banner.text;
					bannerAction.hidden = msg.banner.action !== 'install-docs';
				} else {
					banner.hidden = true;
					bannerText.textContent = '';
					bannerAction.hidden = true;
				}
			}
			if (msg.replaceBody === false) {
				return;
			}
			output.textContent = '';
			if (msg.yaml) {
				renderYaml(output, msg.yaml);
				currentYaml = msg.yaml;
			} else {
				currentYaml = '';
				if (msg.placeholder) {
					var placeholder = document.createElement('span');
					placeholder.className = 'placeholder';
					placeholder.textContent = msg.placeholder;
					output.appendChild(placeholder);
				}
			}
			if (msg.detail) {
				detailWrap.hidden = false;
				detail.textContent = msg.detail;
			} else {
				detailWrap.hidden = true;
				detail.textContent = '';
			}
		}

		function renderYaml(container, text) {
			try {
				var lines = String(text).split('\\n');
				for (var i = 0; i < lines.length; i++) {
					if (i > 0) {
						container.appendChild(document.createTextNode('\\n'));
					}
					container.appendChild(colorLine(lines[i]));
				}
			} catch (err) {
				container.textContent = String(text);
			}
		}

		function colorLine(line) {
			var frag = document.createDocumentFragment();
			var trimmed = line.trim();
			if (trimmed === '---' || trimmed === '...') {
				append(frag, line, 'tok-punct');
				return frag;
			}
			if (/^\\s*#/.test(line)) {
				append(frag, line, 'tok-comment');
				return frag;
			}
			var commentAt = findComment(line);
			var code = commentAt === -1 ? line : line.slice(0, commentAt);
			var comment = commentAt === -1 ? '' : line.slice(commentAt);
			colorCode(frag, code);
			if (comment) {
				append(frag, comment, 'tok-comment');
			}
			return frag;
		}

		function colorCode(parent, code) {
			var match = code.match(/^(\\s*(?:-\\s+)?)([^\\s:#][^:#]*?)(\\s*:)/);
			if (match) {
				append(parent, match[1], '');
				append(parent, match[2], 'tok-key');
				append(parent, match[3], '');
				colorValue(parent, code.slice(match[0].length));
				return;
			}
			colorValue(parent, code);
		}

		function colorValue(parent, text) {
			var re = /("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\b(?:true|false|null|yes|no|True|False|None)\\b|-?\\d+(?:\\.\\d+)?)/g;
			var last = 0;
			var found = re.exec(text);
			while (found) {
				append(parent, text.slice(last, found.index), '');
				var token = found[0];
				var cls = 'tok-number';
				if (token.charAt(0) === '"' || token.charAt(0) === "'") {
					cls = 'tok-string';
				} else if (/[A-Za-z]/.test(token)) {
					cls = 'tok-bool';
				}
				append(parent, token, cls);
				last = found.index + token.length;
				found = re.exec(text);
			}
			append(parent, text.slice(last), '');
		}

		function findComment(line) {
			var single = false;
			var double = false;
			for (var i = 0; i < line.length; i++) {
				var ch = line.charAt(i);
				if (ch === "'" && !double) {
					single = !single;
				} else if (ch === '"' && !single) {
					double = !double;
				} else if (ch === '#' && !single && !double) {
					return i;
				}
			}
			return -1;
		}

		function append(parent, text, cls) {
			if (!text) {
				return;
			}
			if (!cls) {
				parent.appendChild(document.createTextNode(text));
				return;
			}
			var span = document.createElement('span');
			span.className = cls;
			span.textContent = text;
			parent.appendChild(span);
		}

		vscodeApi.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
