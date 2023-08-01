/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as install from './install';

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
	const autoCompletionProvider = vscode.languages.registerCompletionItemProvider('KCL', {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			return autoCompletionItems();
		}
	});

	const installLanguageServer = vscode.commands.registerCommand('kcl.installLanguageServer', async () => {
		const language_server_path = await install.installLanguageServer(client);
		if (language_server_path) {
			startLanguageServerWith(language_server_path);
		}
	});

	context.subscriptions.push(autoCompletionProvider, installLanguageServer);

	let language_server_path: string | undefined = install.kcl_rust_lsp_location();
	if (!language_server_path) {
		language_server_path = await install.promptInstallLanguageServer(client);
	}

	if (language_server_path) {
		startLanguageServerWith(language_server_path);
	}
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

function startLanguageServerWith(language_server_path: string) {
	if (client) {
		// stop the running client if exists
		client.stop();
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
		// Register the server for plain text documents
		documentSelector: [{ scheme: "file", language: "KCL" }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/.k"),
		},
		traceOutputChannel,
	};

	client = new LanguageClient(install.KCL_LANGUAGE_SERVER, "kcl language server", serverOptions, clientOptions);
	client.start();
	install.outputMsg(`${install.KCL_LANGUAGE_SERVER} started!`);
}

function autoCompletionItems(): vscode.CompletionItem[] {
	const snippetCompletions: {label: string, text: string}[] = [
		{label: 'import as', text: 'import ${1:path} as ${2:alias}'},
		{label: 'check statement', text: 'check:\n    '},
		{label: 'schema def', text: 'schema ${1:Name}:\n    '},
		{label: 'schema def for protocol', text: 'schema ${1:Name} for ${2:Name}Protocol:\n    '},
		{label: 'protocol def', text: 'protocol ${1:Name}Protocol:\n    '},
		{label: 'rule def', text: 'rule ${1:Name}Rule:\n    '},
		{label: 'mixin def', text: 'mixin ${1:Name}Mixin for ${2:Name}Protocol:\n    '},
		{label: 'mixin list', text: 'mixin [\n    ${1:Name}\n]'},
		{label: 'str = ${value}', text: 'str = "${1:value}"'},
		{label: 'bool = True', text: 'bool = True\n'},
		{label: 'bool = False', text: 'bool = False\n'},
		{label: 'int = ${value}', text: 'int = ${1:value}'},
		{label: 'float = ${value}', text: 'float = ${1:value}'},
	];

	const KeywordCompletions: {label: string, text: string}[] = [
		{label: 'import', text: 'import '},
		{label: 'assert', text: 'assert '},
		{label: 'if', text: 'if '},
		{label: 'else', text: 'else '},
		{label: 'elif', text: 'elif '},
		{label: 'for', text: 'for '},
		{label: 'or', text: 'or '},
		{label: 'and', text: 'and '},
		{label: 'not', text: 'not '},
		{label: 'in', text: 'in '},
		{label: 'is', text: 'is '},
		{label: 'all', text: 'all'},
		{label: 'any', text: 'any'},
		{label: 'map', text: 'map'},
		{label: 'filter', text: 'filter'},
		{label: 'lambda', text: 'lambda '},
		{label: 'str', text: 'str'},
		{label: 'bool', text: 'bool'},
		{label: 'float', text: 'float'},
		{label: 'int', text: 'int'},
		{label: 'True', text: 'True'},
		{label: 'False', text: 'False'},
		{label: 'None', text: 'None'},
		{label: 'Undefined', text: 'Undefined'},
	];

	return [
		...snippetCompletions.map(({label, text}) => createSnippetCompletion(label, vscode.CompletionItemKind.Snippet, text)),
		...KeywordCompletions.map(({label, text}) => createSnippetCompletion(label, vscode.CompletionItemKind.Keyword, text)),
	];
}

function createSnippetCompletion(label: string, kind: vscode.CompletionItemKind, insertText: string): vscode.CompletionItem {
	const completion = new vscode.CompletionItem(label);
	completion.kind = kind;
	switch (kind) {
		case vscode.CompletionItemKind.Snippet:
			completion.insertText = new vscode.SnippetString(insertText);
			return completion;
		default:
			completion.insertText = insertText;
			return completion;
	}
}