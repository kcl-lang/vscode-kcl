/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import child_process = require("child_process");
import * as shelljs from 'shelljs';

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import { homedir } from 'os';

let client: LanguageClient;

function kcl_rust_lsp_installed(): boolean {
	return shelljs.which("kcl-language-server") ? true : false;
}

export function activate(context: vscode.ExtensionContext) {
	const provider1 = vscode.languages.registerCompletionItemProvider('KCL', {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			// a completion item that inserts its text as snippet,
			// the `insertText`-property is a `SnippetString` which will be
			// honored by the editor.
			const importAsCompletion = new vscode.CompletionItem('import as');
			importAsCompletion.insertText = new vscode.SnippetString('import ${1} as ');

			const mixinCompletion = new vscode.CompletionItem('mixin');
			mixinCompletion.insertText = new vscode.SnippetString('mixin [\n    ${1}\n]');

			const checkCompletion = new vscode.CompletionItem('check');
			checkCompletion.insertText = new vscode.SnippetString('check:\n    ');

			const schemaCompletion = new vscode.CompletionItem('schema');
			schemaCompletion.insertText = new vscode.SnippetString('schema ${1}:\n    ');
			// schemaCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const schemaRelaxedCompletion = new vscode.CompletionItem('schema relaxed');
			schemaRelaxedCompletion.insertText = new vscode.SnippetString('schema relaxed ${1}:\n    ');
			// schemaRelaxedCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const strValueCompletion = new vscode.CompletionItem('str = ${value}');
			strValueCompletion.insertText = new vscode.SnippetString('str = "${1}"');
			// strValueCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const boolTrueCompletion = new vscode.CompletionItem('bool = True');
			boolTrueCompletion.insertText = new vscode.SnippetString('bool = True\n');
			// boolTrueCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const boolFalseCompletion = new vscode.CompletionItem('bool = False');
			boolFalseCompletion.insertText = new vscode.SnippetString('bool = False\n');
			// boolFalseCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const intValueCompletion = new vscode.CompletionItem('int = ${value}');
			intValueCompletion.insertText = new vscode.SnippetString('int = ${1}');
			// intValueCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			const floatValueCompletion = new vscode.CompletionItem('float = ${value}');
			floatValueCompletion.insertText = new vscode.SnippetString('float = ${1}');
			// floatValueCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };


			// a completion item that retriggers IntelliSense when being accepted, Also, the `insertText` is set so that 
			// a space is inserted after `import`
			const importCompletion = new vscode.CompletionItem('import');
			importCompletion.kind = vscode.CompletionItemKind.Keyword;
			importCompletion.insertText = 'import ';

			const assertCompletion = new vscode.CompletionItem('assert');
			assertCompletion.kind = vscode.CompletionItemKind.Keyword;
			assertCompletion.insertText = 'assert ';

			const ifCompletion = new vscode.CompletionItem('if');
			ifCompletion.kind = vscode.CompletionItemKind.Keyword;
			ifCompletion.insertText = 'if ';

			const finalCompletion = new vscode.CompletionItem('final');
			finalCompletion.kind = vscode.CompletionItemKind.Keyword;
			finalCompletion.insertText = 'final ';

			const orCompletion = new vscode.CompletionItem('or');
			orCompletion.kind = vscode.CompletionItemKind.Keyword;
			orCompletion.insertText = 'or ';

			const andCompletion = new vscode.CompletionItem('and');
			andCompletion.kind = vscode.CompletionItemKind.Keyword;
			andCompletion.insertText = 'and ';

			const notCompletion = new vscode.CompletionItem('not');
			notCompletion.kind = vscode.CompletionItemKind.Keyword;
			notCompletion.insertText = 'not ';

			const inCompletion = new vscode.CompletionItem('in');
			inCompletion.kind = vscode.CompletionItemKind.Keyword;
			inCompletion.insertText = 'in ';

			const isCompletion = new vscode.CompletionItem('is');
			isCompletion.kind = vscode.CompletionItemKind.Keyword;
			isCompletion.insertText = 'is ';

			const strCompletion = new vscode.CompletionItem('str');
			strCompletion.kind = vscode.CompletionItemKind.Keyword;
			strCompletion.insertText = 'str\n';

			const boolCompletion = new vscode.CompletionItem('bool');
			boolCompletion.kind = vscode.CompletionItemKind.Keyword;
			boolCompletion.insertText = 'bool\n';

			const floatCompletion = new vscode.CompletionItem('float');
			floatCompletion.kind = vscode.CompletionItemKind.Keyword;
			floatCompletion.insertText = 'str\n';

			const intCompletion = new vscode.CompletionItem('int');
			intCompletion.kind = vscode.CompletionItemKind.Keyword;
			intCompletion.insertText = 'int\n';

			const trueCompletion = new vscode.CompletionItem('True');
			trueCompletion.kind = vscode.CompletionItemKind.Keyword;
			trueCompletion.insertText = 'True';

			const falseCompletion = new vscode.CompletionItem('False');
			falseCompletion.kind = vscode.CompletionItemKind.Keyword;
			falseCompletion.insertText = 'False';

			const noneCompletion = new vscode.CompletionItem('None');
			noneCompletion.kind = vscode.CompletionItemKind.Keyword;
			noneCompletion.insertText = 'None';


			// return all completion items as array
			return [
				importAsCompletion,
				mixinCompletion,
				checkCompletion,
				schemaRelaxedCompletion,
				strValueCompletion,
				boolTrueCompletion,
				boolFalseCompletion,
				intValueCompletion,
				floatValueCompletion,
				importCompletion,
				schemaCompletion,
				assertCompletion,
				ifCompletion,
				finalCompletion,
				orCompletion,
				andCompletion,
				notCompletion,
				inCompletion,
				isCompletion,
				strCompletion,
				boolCompletion,
				floatCompletion,
				intCompletion,
				trueCompletion,
				falseCompletion,
				noneCompletion
			];
		}
	});

	context.subscriptions.push(provider1);

	if (kcl_rust_lsp_installed()) {
		// rust ver
		const traceOutputChannel = vscode.window.createOutputChannel("KCL Language Server trace");
		const command = "kcl-language-server";
		const run: Executable = {
			command,
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

		client = new LanguageClient("kcl-language-server", "kcl language server", serverOptions, clientOptions);
		client.start();
	} else {
		vscode.window.showErrorMessage(`KCL language server is not installed. Please check that "kcl" and "kcl-language-server" are installed and have been added to Path as following link: https://kcl-lang.io/docs/user_docs/getting-started/install`);
		// python ver
		let kusionPath = process.env['KUSION_PATH'];
		if (kusionPath == undefined) {
			kusionPath = path.join(homedir(), ".kusion");
		}
		const lspPath = path.join(kusionPath, "kclvm/bin/kcl-go");
		const lspLogPath = path.join(kusionPath, "logs/lsp.log");
		let logLevel = process.env['KCL_LSP_LOG_LEVEL'];
		if (logLevel == undefined) {
			logLevel = "1";
		}
		const logLevelNumber: number = ~~logLevel;

		if (!fs.existsSync(lspPath)) {
			return;
		}
		try {
			const result = child_process.execSync(lspPath + " lsp --version");
		} catch (error) {
			console.log(`Current kcl version does not support language server. Please update to kcl v0.3.3+`);
			return;
		}

		const executable = {
			command: lspPath,
			args: ["lsp", "--log-file", lspLogPath, "--log-level", "" + logLevelNumber],
		};

		const serverOptions: ServerOptions = {
			run: executable,
			debug: executable,
		};
		// Options to control the language client
		const clientOptions: LanguageClientOptions = {
			// Register the server for KCL documents
			documentSelector: [{ scheme: 'file', language: 'KCL' }],
			synchronize: {
				// Notify the server about file changes to '.clientrc files contained in the workspace
				fileEvents: vscode.workspace.createFileSystemWatcher('**/.k')
			}
		};

		// Create the language client and start the client.
		client = new LanguageClient(
			'kclLanguageServerClient',
			'KCL Language Server Client',
			serverOptions,
			clientOptions
		);

		// Start the client. This will also launch the server
		client.start();
	}
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}