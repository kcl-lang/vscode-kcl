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

	// const installLanguageServer = vscode.commands.registerCommand('kcl.installLanguageServer', async () => {
	// 	const language_server_path = await install.installLanguageServer(client);
	// 	if (language_server_path) {
	// 		startLanguageServerWith(language_server_path);
	// 	}
	// });

	context.subscriptions.push(autoCompletionProvider);

	const language_server_path: string | undefined = install.kcl_rust_lsp_location();
	// if (!language_server_path) {
	// 	language_server_path = await install.promptInstallLanguageServer(client);
	// }

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
		{label: 'type', text: 'type'},
	];

	const BuiltinFunctionsCompletions: {label: string, text: string, doc: string}[] = [
		{label: "option(key: str)", text: "option(${1:key})", doc: "Return the top level argument by the key"},
		{label: "print()", text: "print(${1:value})", doc: "Prints the values to a stream, or to sys.stdout by default.\n\nOptional keyword arguments:\n\nsep:   string inserted between values, default a space.\n\nend:   string appended after the last value, default a newline."},
		{label: "multiplyof(a: int, b: int)", text: "multiplyof(${1:a}, ${2:b})", doc: "Check if the modular result of a and b is 0."},
		{label: "isunique(inval: [])", text: "isunique(${1:inval})", doc: "Check if a list has duplicated elements"},
		{label: "len(inval: [])", text: "len(${1:inval})", doc: "Return the length of a value."},
		{label: "abs(inval: any)", text: "abs(${1:inval})", doc: "Return the absolute value of the argument."},
		{label: "all_true(inval: [])", text: "all_true(${1:inval})", doc: "Return True if bool(x) is True for all values x in the iterable.\n\nIf the iterable is empty, return True."},
		{label: "any_true(inval: [])", text: "any_true(${1:inval})", doc: "Return True if bool(x) is True for any x in the iterable.\n\nIf the iterable is empty, return False."},
		{label: "hex(number: int)", text: "hex(${1:number})", doc: "Return the hexadecimal representation of an integer."},
		{label: "bin(number: int)", text: "bin(${1:number})", doc: "Return the binary representation of an integer."},
		{label: "oct(number: int)", text: "oct(${1:number})", doc: "Return the octal representation of an integer."},
		{label: "ord(c: str)", text: "ord(${1:c})", doc: "Return the Unicode code point for a one-character string."},
		{label: "sorted(inval: str|[]|{:}, reverse: bool)", text: "sorted(${1:inval}, ${2:reverse})", doc: "Return a new list containing all items from the iterable in ascending order.\n\nA custom key function can be supplied to customize the sort order, and the reverse flag can be set to request the result in descending order."},
		{label: "range(start: int, stop: int, step: int)", text: "range(${1:start}, ${2:stop}, ${3:step})", doc: "Return the range of a value."},
		{label: "max()", text: "max()", doc: "With a single iterable argument, return its biggest item. The default keyword-only argument specifies an object to return if the provided iterable is empty. With two or more arguments, return the largest argument."},
		{label: "min()", text: "min()", doc: "With a single iterable argument, return its smallest item. The default keyword-only argument specifies an object to return if the provided iterable is empty. With two or more arguments, return the smallest argument."},
		{label: "sum(iterable: [], start: any)", text: "sum(${1:iterable}, ${2: start})", doc: "When the iterable is empty, return the start value. This function is intended specifically for use with numeric values and may reject non-numeric types."},
		{label: "pow(x: int|float, y: int|float, z: int|float)", text: "pow(${1:x}, ${2: y}, ${3: z})", doc: "Equivalent to x**y (with two arguments) or x**y % z (with three arguments).\n\nSome types, such as ints, are able to use a more efficient algorithm when invoked using the three argument form."},
		{label: "round(number: int|float, ndigits: int)", text: "round(${1:number}, ${2:ndigits})", doc: "Round a number to a given precision in decimal digits.\n\nThe return value is an integer if ndigits is omitted or None.Otherwise the return value has the same type as the number. ndigits may be negative."},
		{label: "zip()", text: "zip()", doc: "Return a zip object whose next method returns a tuple where the i-th element comes from the i-th iterable argument."},
		{label: "int(number: any, base: int)", text: "int(${1:number}, ${2:base})", doc: "Convert a number or string to an integer, or return 0 if no arguments are given. For floating point numbers, this truncates towards zero."},
		{label: "float(number: any)", text: "float(${1:number})", doc: "Convert a string or number to a floating point number, if possible."},
		{label: "bool(x: any)", text: "bool(${1:x})", doc: "Returns True when the argument x is true, False otherwise. The builtins True and False are the only two instances of the class bool. The class bool is a subclass of the class int, and cannot be subclassed."},
		{label: "str(x: any)", text: "str(${1:x})", doc: "Create a new string object from the given object. If encoding or errors is specified, then the object must expose a data buffer that will be decoded using the given encoding and error handler."},
		{label: "list(x: any)", text: "list(${1:number})", doc: "Built-in mutable sequence. If no argument is given, the constructor creates a new empty list. The argument must be an iterable if specified."},
		{label: "dict(x: any)", text: "dict(${1:number})", doc: "Built-in mutable dict."},
		{label: "typeof(x: any, full_name: bool)", text: "typeof(${1:x}, ${2: full_name})", doc: "Return the type of the object"},
	];

	return [
		...snippetCompletions.map(({label, text}) => createSnippetCompletion(label, vscode.CompletionItemKind.Snippet, text, "")),
		...KeywordCompletions.map(({label, text}) => createSnippetCompletion(label, vscode.CompletionItemKind.Keyword, text, "")),
		// ...BuiltinFunctionsCompletions.map(({label, text, doc}) => createSnippetCompletion(label, vscode.CompletionItemKind.Function, text, doc)),
	];
}

function createSnippetCompletion(label: string, kind: vscode.CompletionItemKind, insertText: string, doc: string): vscode.CompletionItem {
	const completion = new vscode.CompletionItem(label);
	completion.kind = kind;
	switch (kind) {
		case vscode.CompletionItemKind.Snippet:
			completion.insertText = new vscode.SnippetString(insertText);
			return completion;
		case vscode.CompletionItemKind.Function:
			completion.insertText = new vscode.SnippetString(insertText);
			completion.documentation = new vscode.MarkdownString(doc);
			return completion;
		default:
			completion.insertText = insertText;
			return completion;
	}
}