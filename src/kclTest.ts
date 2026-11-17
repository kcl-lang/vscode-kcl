/**
 * Run KCL unit tests from the editor.
 *
 * The language server already emits a code lens whose command is `kcl.runTest`
 * with arguments `[fileUri, testName]`. The editor context menu uses the same
 * command for the test under the cursor or the selected test name. Both call
 * `kcl test --run`, the test runner shipped with the KCL CLI.
 *
 * KCL has no debug adapter, and `kcl test` has no debug flag, so this does not
 * start a debugger.
 */

import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import {
	RUN_FILE_TESTS_COMMAND,
	RUN_TEST_COMMAND,
	TestRunPlan,
	TextSelection,
	isTestName,
	planCursorTest,
	planFileTests,
	planNamedTest,
} from './kclTestDiscovery';

const KCL_INSTALL_URL = 'https://kcl-lang.io/docs/user_docs/getting-started/install';

export function registerKclTestRunner(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(RUN_TEST_COMMAND, (...args: unknown[]) => runTest(args)),
		vscode.commands.registerCommand(RUN_FILE_TESTS_COMMAND, () => runFileTests()),
	);
}

async function runTest(args: unknown[]): Promise<void> {
	try {
		const named = lensArguments(args);
		if (named) {
			const planned = planNamedTest(named.filePath, named.name);
			if (!planned.ok) {
				vscode.window.showErrorMessage(`KCL: ${planned.message}`);
				return;
			}
			await runPlan(planned.plan, vscode.Uri.file(named.filePath));
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('KCL: Open a *_test.k file to run a test.');
			return;
		}
		const planned = planCursorTest(editor.document.uri.fsPath, editor.document.getText(), selectionOf(editor));
		if (!planned.ok) {
			vscode.window.showErrorMessage(`KCL: ${planned.message}`);
			return;
		}
		await runPlan(planned.plan, editor.document.uri);
	} catch (error) {
		vscode.window.showErrorMessage(`KCL: ${errorMessage(error)}`);
	}
}

async function runFileTests(): Promise<void> {
	try {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('KCL: Open a *_test.k file to run tests.');
			return;
		}
		const planned = planFileTests(editor.document.uri.fsPath, editor.document.getText());
		if (!planned.ok) {
			vscode.window.showErrorMessage(`KCL: ${planned.message}`);
			return;
		}
		await runPlan(planned.plan, editor.document.uri);
	} catch (error) {
		vscode.window.showErrorMessage(`KCL: ${errorMessage(error)}`);
	}
}

async function runPlan(plan: TestRunPlan, uri: vscode.Uri): Promise<void> {
	const kclPath = kclBinary();
	if (!kclPath) {
		vscode.window.showErrorMessage(
			`KCL: The kcl command is required to run tests. Install it from ${KCL_INSTALL_URL} and add it to PATH.`,
		);
		return;
	}
	if (!await saveRelated(uri)) {
		vscode.window.showErrorMessage('KCL: Save the test file before running it.');
		return;
	}
	await launch(kclPath, plan);
}

/** Code lens arguments are `[fileUri, testName]`, as emitted by kcl-language-server. */
function lensArguments(args: unknown[]): { filePath: string; name: string } | undefined {
	if (args.length < 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
		return undefined;
	}
	if (!isTestName(args[1])) {
		return undefined;
	}
	const filePath = args[0].startsWith('file:') ? vscode.Uri.parse(args[0]).fsPath : args[0];
	return { filePath, name: args[1] };
}

function selectionOf(editor: vscode.TextEditor): TextSelection {
	const selection = editor.selection;
	return {
		startLine: selection.start.line,
		startCharacter: selection.start.character,
		endLine: selection.end.line,
		endCharacter: selection.end.character,
		text: editor.document.getText(selection),
	};
}

function kclBinary(): string | undefined {
	const found = shelljs.which('kcl');
	if (!found) {
		return undefined;
	}
	const location = found.toString();
	return location || undefined;
}

/** `kcl test` reads the files on disk, so write dirty KCL buffers in this workspace first. */
async function saveRelated(uri: vscode.Uri): Promise<boolean> {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	const dirty = vscode.workspace.textDocuments.filter((document) => {
		if (!document.isDirty || document.uri.scheme !== 'file' || !document.fileName.endsWith('.k')) {
			return false;
		}
		if (!folder) {
			return document.uri.toString() === uri.toString();
		}
		return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === folder.uri.toString();
	});
	for (const document of dirty) {
		if (!await document.save()) {
			return false;
		}
	}
	return true;
}

async function launch(kclPath: string, plan: TestRunPlan): Promise<void> {
	const execution = new vscode.ShellExecution(
		{ value: kclPath, quoting: vscode.ShellQuoting.Strong },
		plan.args.map((value) => ({ value, quoting: vscode.ShellQuoting.Strong })),
		{ cwd: plan.cwd },
	);
	const task = new vscode.Task(
		{ type: 'kcl', task: plan.title },
		vscode.TaskScope.Global,
		plan.title,
		'KCL',
		execution,
		[],
	);
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Dedicated,
		clear: true,
	};
	await vscode.tasks.executeTask(task);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
