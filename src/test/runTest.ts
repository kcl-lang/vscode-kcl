import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test.
		// Pin below 1.110. Later macOS builds renamed Contents/MacOS/Electron to
		// Code and removed the compatibility symlink. @vscode/test-electron 2.x
		// still launches the old name, so "stable" fails CI with ENOENT.
		await runTests({ extensionDevelopmentPath, extensionTestsPath, version: '1.109.2' });
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
