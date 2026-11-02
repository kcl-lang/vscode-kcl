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
		// 1.109 is the last stable release whose macOS app still contains
		// Contents/MacOS/Electron. Later builds renamed that binary to Code,
		// which @vscode/test-electron 2.3.8 cannot launch.
		await runTests({ extensionDevelopmentPath, extensionTestsPath, version: '1.109.0' });
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
