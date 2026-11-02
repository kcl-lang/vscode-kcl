/* eslint-env mocha */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectSettings, stripSettingsOutput } from '../../preview/kclSettings';
import {
	DIAGNOSTIC_ERROR,
	FIX_ERRORS_MESSAGE,
	blockedView,
	configurationHasErrors,
	resultView,
	withUnsavedStackHint,
} from '../../preview/previewModel';
import { describePreview, prepareRun } from '../../preview/previewTarget';
import {
	isUsageError,
	kclRunAttempts,
	runAttempts,
	startProcess,
	stripAnsi,
} from '../../preview/runKcl';

suite('KCL preview', () => {
	test('settings file lists entry files and an output path', () => {
		const text = [
			'kcl_cli_configs:',
			'  files:',
			'    - main.k # entry',
			'    - "../base/base.k"',
			'  disable_none: false',
			'  output: ./ci/out.yaml',
			'kcl_options:',
			'  - key: env',
			'    value: dev',
			'',
		].join('\n');
		const inspected = inspectSettings(text);
		assert.deepStrictEqual(inspected.entryFiles, ['main.k', '../base/base.k']);
		assert.strictEqual(inspected.writesOutput, true);

		const stripped = stripSettingsOutput(text);
		assert.strictEqual(stripped.changed, true);
		assert.ok(!/^.*output\s*:/m.test(stripped.text));
		assert.ok(stripped.text.indexOf('disable_none: false') !== -1);
		assert.ok(stripped.text.indexOf('kcl_options:') !== -1);
		assert.ok(stripped.text.indexOf('main.k') !== -1);
	});

	test('settings accept the singular file key, inline lists, and ignore output elsewhere', () => {
		const text = [
			'kcl_options:',
			'  - key: output',
			'    value: ./not-a-setting.yaml',
			'kcl_cli_configs:',
			'  file: [main.k, "lib.k"]',
			'  disable_none: true',
			'',
		].join('\n');
		const inspected = inspectSettings(text);
		assert.deepStrictEqual(inspected.entryFiles, ['main.k', 'lib.k']);
		assert.strictEqual(inspected.writesOutput, false);
		assert.strictEqual(stripSettingsOutput(text).changed, false);
	});

	test('output block before files is removed without dropping the file list', () => {
		const text = [
			'kcl_cli_configs:',
			'  output:',
			'    - ./golden.yaml',
			'  files:',
			'    - "main.k"',
			'',
		].join('\n');
		const stripped = stripSettingsOutput(text);
		assert.strictEqual(stripped.changed, true);
		assert.deepStrictEqual(inspectSettings(stripped.text).entryFiles, ['main.k']);
		assert.strictEqual(inspectSettings(stripped.text).writesOutput, false);
	});

	test('a file outside a stack previews only that file', () => {
		const root = tempDir();
		try {
			const file = path.join(root, 'hello.k');
			fs.writeFileSync(file, 'name = "app"\n');
			const described = describePreview({
				scheme: 'file',
				fsPath: file,
				workspaceRoot: root,
				isDirty: false,
			});
			assert.strictEqual(described.kind, 'file');
			assert.strictEqual(described.useBuffer, false);
			assert.deepStrictEqual(described.entryFiles, [path.resolve(file)]);

			const prepared = prepareRun(described, 'ignored');
			try {
				assert.deepStrictEqual(prepared.attempts, kclRunAttempts({ filePath: path.resolve(file) }));
				assert.strictEqual(path.resolve(prepared.attempts[0][1]), path.resolve(file));
			} finally {
				prepared.dispose();
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('unsaved single files are previewed from the editor buffer', () => {
		const root = tempDir();
		try {
			const file = path.join(root, 'hello.k');
			fs.writeFileSync(file, 'name = "disk"\n');
			const described = describePreview({
				scheme: 'file',
				fsPath: file,
				workspaceRoot: root,
				isDirty: true,
			});
			assert.strictEqual(described.useBuffer, true);
			const prepared = prepareRun(described, 'name = "buffer"\n');
			const bufferPath = prepared.attempts[0][1];
			try {
				assert.notStrictEqual(path.resolve(bufferPath), path.resolve(file));
				assert.strictEqual(fs.readFileSync(bufferPath, 'utf8'), 'name = "buffer"\n');
			} finally {
				prepared.dispose();
			}
			assert.ok(!fs.existsSync(bufferPath));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('kcl.yaml selects the stack and strips output before the run', () => {
		const root = tempDir();
		try {
			fs.writeFileSync(path.join(root, 'kcl.mod'), '[package]\nname = "demo"\nedition = "0.10.0"\nversion = "0.0.1"\n');
			fs.writeFileSync(path.join(root, 'main.k'), 'name = "app"\n');
			fs.writeFileSync(path.join(root, 'kcl.yaml'), [
				'kcl_cli_configs:',
				'  files:',
				'    - main.k',
				'  output: ./golden.yaml',
				'',
			].join('\n'));
			const described = describePreview({
				scheme: 'file',
				fsPath: path.join(root, 'main.k'),
				isDirty: true,
			});
			assert.strictEqual(described.kind, 'stack');
			assert.strictEqual(described.useBuffer, false);
			assert.ok(described.meta.indexOf('kcl.yaml') !== -1);
			assert.ok(described.entryFiles.some(file => path.resolve(file) === path.resolve(root, 'main.k')));

			const prepared = prepareRun(described, 'name = "dirty"\n');
			const settingsArg = prepared.attempts[0][2];
			try {
				assert.strictEqual(prepared.attempts[0][0], 'run');
				assert.strictEqual(prepared.attempts[0][1], '-Y');
				assert.notStrictEqual(path.resolve(settingsArg), path.resolve(root, 'kcl.yaml'));
				const text = fs.readFileSync(settingsArg, 'utf8');
				assert.ok(text.indexOf('main.k') !== -1);
				assert.ok(!/output\s*:/.test(text));
				assert.ok(fs.existsSync(path.join(root, 'kcl.yaml')));
			} finally {
				prepared.dispose();
			}
			assert.ok(!fs.existsSync(settingsArg));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('kcl.mod without settings runs the package, and the search stops at the workspace root', () => {
		const root = tempDir();
		try {
			fs.writeFileSync(path.join(root, 'kcl.mod'), '[package]\nname = "demo"\nedition = "0.10.0"\nversion = "0.0.1"\n');
			const nested = path.join(root, 'nested');
			fs.mkdirSync(nested);
			const file = path.join(nested, 'main.k');
			fs.writeFileSync(file, 'a = 1\n');

			const bounded = describePreview({
				scheme: 'file',
				fsPath: file,
				workspaceRoot: nested,
				isDirty: false,
			});
			assert.strictEqual(bounded.kind, 'file');

			const stacked = describePreview({
				scheme: 'file',
				fsPath: file,
				workspaceRoot: root,
				isDirty: false,
			});
			assert.strictEqual(stacked.kind, 'stack');
			assert.ok(stacked.meta.indexOf('kcl.mod') !== -1);
			const prepared = prepareRun(stacked, 'a = 1\n');
			try {
				assert.deepStrictEqual(prepared.attempts, [
					['run', '--format', 'yaml', '--no_style'],
					['run'],
				]);
				assert.strictEqual(path.resolve(prepared.cwd), path.resolve(root));
			} finally {
				prepared.dispose();
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('nearest kcl.yaml wins over a parent module', () => {
		const root = tempDir();
		try {
			fs.writeFileSync(path.join(root, 'kcl.mod'), '[package]\nname = "demo"\nedition = "0.10.0"\nversion = "0.0.1"\n');
			const dev = path.join(root, 'dev');
			fs.mkdirSync(dev);
			fs.writeFileSync(path.join(dev, 'kcl.yaml'), 'kcl_cli_configs:\n  files:\n    - main.k\n');
			fs.writeFileSync(path.join(dev, 'main.k'), 'env = "dev"\n');
			const described = describePreview({
				scheme: 'file',
				fsPath: path.join(dev, 'main.k'),
				workspaceRoot: root,
				isDirty: false,
			});
			assert.strictEqual(described.kind, 'stack');
			assert.strictEqual(path.resolve(described.stackRoot || ''), path.resolve(dev));
			assert.ok(described.meta.indexOf('kcl.yaml') !== -1);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('error diagnostics block preview and warnings do not', () => {
		const file = path.resolve('/work/main.k');
		const uri = { scheme: 'file', fsPath: file, toString: () => 'file:///work/main.k' };
		const other = { scheme: 'file', fsPath: path.resolve('/work/other.k'), toString: () => 'file:///work/other.k' };
		assert.strictEqual(configurationHasErrors([file], uri, [
			[uri, [{ severity: DIAGNOSTIC_ERROR }]],
		]), true);
		assert.strictEqual(configurationHasErrors([file], uri, [
			[uri, [{ severity: 1 }]],
		]), false);
		assert.strictEqual(configurationHasErrors([file], uri, [
			[other, [{ severity: DIAGNOSTIC_ERROR }]],
		]), false);
		assert.strictEqual(configurationHasErrors([], uri, [
			[uri, [{ severity: DIAGNOSTIC_ERROR }]],
		]), true);
	});

	test('invalid configuration previews as an empty warning, not as YAML', () => {
		const blocked = blockedView({ title: 'KCL Preview', meta: 'Single file · main.k' });
		assert.strictEqual(blocked.outcome, 'invalid');
		assert.strictEqual(blocked.yaml, '');
		assert.strictEqual(blocked.banner && blocked.banner.text, FIX_ERRORS_MESSAGE);

		const failed = resultView(
			{ title: 'Preview main.k', meta: 'Single file · main.k' },
			{ exitCode: 1, stdout: '', stderr: 'error[E1001]: InvalidSyntax\n --> main.k:1:1\n' },
			false,
		);
		const checkFailed = resultView(
			{ title: 'Preview main.k', meta: 'Single file · main.k' },
			{
				exitCode: 1,
				stdout: '',
				stderr: 'EvaluationError\n --> main.k:6:5\n  |\n6 | p = Person {age = 1}\n  |     ^ Instance check failed\n\n --> main.k:4:1\n  |  Check failed on the condition\n',
			},
			false,
		);
		assert.strictEqual(checkFailed.outcome, 'invalid');
		assert.strictEqual(checkFailed.yaml, '');
		assert.strictEqual(failed.outcome, 'invalid');
		assert.strictEqual(failed.yaml, '');
		assert.strictEqual(failed.banner && failed.banner.tone, 'warning');
		assert.ok(failed.detail.indexOf('InvalidSyntax') !== -1);

		const unsupported = resultView(
			{ title: 'Preview main.k', meta: 'Single file · main.k' },
			{ exitCode: 2, stdout: '', stderr: 'error: unknown flag: --format' },
			false,
		);
		assert.strictEqual(unsupported.outcome, 'unavailable');
		assert.ok(unsupported.banner && unsupported.banner.text.indexOf('does not support') !== -1);

		const missing = resultView(
			{ title: 'KCL Preview', meta: '' },
			{ exitCode: null, stdout: '', stderr: '', error: 'not-found' },
			false,
		);
		assert.strictEqual(missing.outcome, 'unavailable');
		assert.strictEqual(missing.banner && missing.banner.action, 'install-docs');
		assert.strictEqual(missing.yaml, '');
	});

	test('a successful run shows YAML and a dirty stack explains unsaved edits', () => {
		const view = resultView(
			{ title: 'KCL Stack Preview', meta: 'Stack · app/kcl.mod' },
			{ exitCode: 0, stdout: 'name: app\n', stderr: '' },
			true,
		);
		assert.strictEqual(view.outcome, 'ok');
		assert.strictEqual(view.yaml, 'name: app\n');
		assert.strictEqual(view.canCopy, true);
		assert.ok(view.banner && view.banner.text.indexOf('Unsaved changes are not included') !== -1);

		const hinted = withUnsavedStackHint(resultView(
			{ title: 'KCL Stack Preview', meta: 'Stack · app/kcl.mod' },
			{ exitCode: 0, stdout: 'name: app\n', stderr: '' },
			false,
		));
		assert.strictEqual(hinted.replaceBody, false);
		assert.ok(hinted.banner && hinted.banner.text.indexOf('Unsaved changes are not included') !== -1);
	});

	test('usage errors retry and compile errors do not', async () => {
		const calls: string[][] = [];
		const retried = await runAttempts([
			['run', '--format', 'yaml'],
			['run'],
		], async args => {
			calls.push(args);
			if (args.length > 1) {
				return { exitCode: 2, stdout: '', stderr: 'error: unknown flag: --format' };
			}
			return { exitCode: 0, stdout: 'ok: true\n', stderr: '' };
		});
		assert.strictEqual(retried.exitCode, 0);
		assert.strictEqual(calls.length, 2);
		assert.strictEqual(isUsageError({ exitCode: 2, stdout: '', stderr: 'error: unknown flag: --format' }), true);

		const once: string[][] = [];
		const compileError = await runAttempts([
			['run', 'main.k'],
			['main.k'],
		], async args => {
			once.push(args);
			return { exitCode: 1, stdout: '', stderr: 'error[E1001]: InvalidSyntax' };
		});
		assert.strictEqual(compileError.exitCode, 1);
		assert.strictEqual(once.length, 1);
	});

	test('process runner captures stdout, cancellation, and a missing binary', async function () {
		this.timeout(15000);
		const ok = await startProcess(process.execPath, ['-e', 'process.stdout.write("hello-yaml")'], process.cwd(), 5000).result;
		assert.strictEqual(ok.exitCode, 0);
		assert.strictEqual(ok.stdout, 'hello-yaml');

		const running = startProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], process.cwd(), 10000);
		running.cancel();
		const cancelled = await running.result;
		assert.strictEqual(cancelled.error, 'cancelled');

		const missing = await startProcess('kcl-preview-missing-bin-xyz', [], process.cwd(), 5000).result;
		assert.strictEqual(missing.error, 'not-found');

		assert.strictEqual(stripAnsi('\u001B[31mname\u001B[0m: app'), 'name: app');
	});

	test('package.json exposes preview commands only for KCL editors', () => {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
		const commands = pkg.contributes.commands.map((command: { command: string }) => command.command);
		assert.ok(commands.indexOf('kcl.openPreview') !== -1);
		assert.ok(commands.indexOf('kcl.openPreviewToSide') !== -1);
		assert.ok(commands.indexOf('kcl.previewUnavailable') !== -1);
		assert.ok(commands.indexOf('kcl.previewToSideUnavailable') !== -1);

		const open = pkg.contributes.keybindings.find((binding: { command: string }) => binding.command === 'kcl.openPreview');
		assert.strictEqual(open.key, 'shift+ctrl+v');
		assert.strictEqual(open.mac, 'shift+cmd+v');
		assert.strictEqual(open.when, 'editorLangId == KCL');

		const side = pkg.contributes.keybindings.find((binding: { command: string }) => binding.command === 'kcl.openPreviewToSide');
		assert.strictEqual(side.key, 'ctrl+k v');
		assert.strictEqual(side.mac, 'cmd+k v');

		const palette = pkg.contributes.menus.commandPalette;
		const paletteWhen = palette.map((item: { command: string; when: string }) => item.command + ' :: ' + item.when);
		assert.ok(paletteWhen.indexOf('kcl.openPreview :: editorLangId == KCL && !kcl.previewHasErrors') !== -1);
		assert.ok(paletteWhen.indexOf('kcl.previewUnavailable :: editorLangId == KCL && kcl.previewHasErrors') !== -1);

		const toolbar = pkg.contributes.menus['editor/title'];
		assert.ok(toolbar.some((item: { command: string }) => item.command === 'kcl.openPreviewToSide'));
		assert.ok(toolbar.some((item: { command: string }) => item.command === 'kcl.previewToSideUnavailable'));

		const tab = pkg.contributes.menus['editor/title/context'];
		assert.ok(tab.some((item: { command: string }) => item.command === 'kcl.openPreview'));
		assert.ok(tab.some((item: { command: string }) => item.command === 'kcl.previewUnavailable'));
	});
});

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'kcl-preview-test-'));
}
