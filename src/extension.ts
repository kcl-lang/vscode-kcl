/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as install from './install';
import { findEmbeddedKclRegions } from './embeddedKcl';
import { disposeEmbeddedKcl, isEmbeddedVirtualUri, redirectEmbeddedDiagnostics, registerEmbeddedKcl } from './embeddedKclEditor';
import { kclCompletionItems } from './kclCompletions';

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let starting: Promise<void> | undefined;

export async function activate(context: vscode.ExtensionContext) {
	console.log('KCL extension activated');
	const autoCompletionProvider = vscode.languages.registerCompletionItemProvider('KCL', {
		provideCompletionItems() {
			return kclCompletionItems();
		}
	});

	// const installLanguageServer = vscode.commands.registerCommand('kcl.installLanguageServer', async () => {
	// 	const language_server_path = await install.installLanguageServer(client);
	// 	if (language_server_path) {
	// 		startLanguageServerWith(language_server_path);
	// 	}
	// });

	const restartLanguageServerCommand = vscode.commands.registerCommand('kcl.restartLanguageServer', restartLanguageServer, "KCL: Restart Language Server");
	console.log('KCL: Restart Language Server command registered');

	context.subscriptions.push(autoCompletionProvider);
    context.subscriptions.push(restartLanguageServerCommand);
	registerEmbeddedKcl(context, {
		getClient: () => client,
		ensureClient: ensureLanguageServer,
	});
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
		if ((document.languageId === 'KCL' || document.languageId === 'MOD') && !isEmbeddedVirtualUri(document.uri)) {
			void ensureLanguageServer(true);
		}
	}));

	const active = vscode.window.activeTextEditor?.document;
	if (active && (active.languageId === 'KCL' || active.languageId === 'MOD') && !isEmbeddedVirtualUri(active.uri)) {
		await ensureLanguageServer(true);
	} else if (active && active.languageId === 'yaml' && findEmbeddedKclRegions(active.getText()).length > 0) {
		await ensureLanguageServer(false);
	}
}

export async function deactivate(): Promise<void> {
	await disposeEmbeddedKcl();
	if (client) {
		await client.stop();
	}
}

async function ensureLanguageServer(prompt: boolean): Promise<void> {
	if (client) {
		return;
	}
	const languageServerPath = install.kcl_lsp_location();
	if (!languageServerPath) {
		if (prompt) {
			await install.promptInstallLanguageServer(undefined);
		}
		return;
	}
	if (!starting) {
		starting = startLanguageServerWith(languageServerPath);
	}
	await starting;
}

async function startLanguageServerWith(language_server_path: string): Promise<void> {
	if (client) {
		await client.stop();
		client = undefined;
	}
	install.outputMsg(`Starting language server with ${language_server_path}`);
	// start language server
	const traceOutputChannel = vscode.window.createOutputChannel("KCL Language Server trace");
	const run: Executable = {
		command: language_server_path,
		options: {
			env: {
				...process.env,
				RUST_LOG: "debug",
			},
		},
	};
	const serverOptions: ServerOptions = {
		run,
		debug: run,
	};
	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for KCL documents, including embedded virtual files.
		documentSelector: [{ scheme: "file", language: "KCL" }],
		synchronize: {
			fileEvents:[vscode.workspace.createFileSystemWatcher("**/*.k"),
			vscode.workspace.createFileSystemWatcher("**/kcl.yaml"),
			vscode.workspace.createFileSystemWatcher("**/kcl.mod"),
		]
		},
		traceOutputChannel,
		middleware: {
			handleDiagnostics: (uri, diagnostics, next) => {
				redirectEmbeddedDiagnostics(uri, diagnostics, next);
			},
		},
	};

	client = new LanguageClient(install.KCL_LANGUAGE_SERVER, "kcl language server", serverOptions, clientOptions);
	await client.start();
	install.outputMsg(`${install.KCL_LANGUAGE_SERVER} started!`);
}

function restartLanguageServer() {
    if (!client) {
        return;
    }
    const running = client;
    client = undefined;
    starting = undefined;
    void running.stop().then(() => {
        const languageServerPath = install.kcl_rust_lsp_location();
        if (languageServerPath) {
            starting = startLanguageServerWith(languageServerPath);
        }
    });
}