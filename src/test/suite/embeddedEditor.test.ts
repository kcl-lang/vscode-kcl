import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Embedded KCL editor', () => {
	test('offers KCL completions inside a KCLInput block and not on the YAML keys', async () => {
		const extension = vscode.extensions.getExtension('kcl.kcl-vscode-extension');
		assert.ok(extension, 'KCL extension is installed in the test host');
		await extension.activate();

		const content = [
			'kind: KCLInput',
			'spec:',
			'  source: |',
			'    ',
			'  target: Resources',
			'',
		].join('\n');
		const document = await vscode.workspace.openTextDocument({ language: 'yaml', content });
		await vscode.window.showTextDocument(document);
		const inside = new vscode.Position(3, 4);
		const insideItems = await completionsAt(document, inside);
		assert.ok(insideItems.includes('schema def'), `expected schema completion, got ${insideItems.join(', ')}`);
		assert.ok(insideItems.includes('import'));

		const outsideItems = await completionsAt(document, new vscode.Position(0, 1));
		assert.ok(!outsideItems.includes('schema def'));
	});
});

async function completionsAt(document: vscode.TextDocument, position: vscode.Position): Promise<string[]> {
	const result = await vscode.commands.executeCommand<vscode.CompletionList | vscode.CompletionItem[]>(
		'vscode.executeCompletionItemProvider',
		document.uri,
		position,
	);
	const items = Array.isArray(result) ? result : result.items;
	return items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
}
