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
		// Current macOS builds no longer ship Contents/MacOS/Electron, which
		// @vscode/test-electron 2.x launches. 1.109.2 still does.
		// The download idle timeout defaults to 15s. A stall on the macOS
		// runner aborts the transfer and crashes the process.
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			version: '1.109.2',
			timeout: 120000,
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
