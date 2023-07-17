import * as assert from 'assert';
import * as install from '../../install';
import * as os from 'os';
import * as fs from 'fs';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', function() {
	vscode.window.showInformationMessage('Start all tests.');
	this.timeout(1000000);

	test('Sample test modify', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('installation: getBinaryName test', () => {
		const binaryName = install.getBinaryName(install.KCL_LANGUAGE_SERVER, 'v0.5.0');
		if (os.type() === 'Windows_NT' && os.arch() === 'x64') {
			assert.strictEqual(binaryName, `kcl-language-server-v0.5.0-windows.exe`);
		}
		if (os.type() === 'Linux' && os.arch() === 'x64') {
			assert.strictEqual(binaryName, `kcl-language-server-v0.5.0-linux-amd64`);
		}
		if (os.type() === 'Darwin' && os.arch() === 'x64') {
			assert.strictEqual(binaryName, `kcl-language-server-v0.5.0-darwin-amd64`);
		}
		if (os.type() === 'Darwin' && os.arch() === 'arm64') {
			assert.strictEqual(binaryName, `kcl-language-server-v0.5.0-darwin-arm64`);
		}
	});

	test('installation e2e test', async () => {
		
		// verify there's no pre-installed binary
		assert.ok(!install.kcl_rust_lsp_installed());

		const installPath = install.getInstallPath(install.KCL_LANGUAGE_SERVER);
		assert.ok(!fs.existsSync(installPath));
	
		// verify install success
		await install.installLanguageServer();
		assert.ok(fs.existsSync(installPath));

		// todo: check the downloaded binary is executable on current os
	});
});