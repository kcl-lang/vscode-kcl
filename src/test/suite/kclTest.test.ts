import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	RUN_FILE_TESTS_COMMAND,
	RUN_TEST_COMMAND,
	TestCase,
	findTestCases,
	isKclTestFile,
	planCursorTest,
	planFileTests,
	planNamedTest,
	runPattern,
} from '../../kclTestDiscovery';

const CODE_LENS_FIXTURE = [
	'func = lambda x: str -> str {',
	'    x',
	'}',
	'',
	'test_func_0 = lambda {',
	'    assert func("a") == "a"',
	'}',
	'',
	'not_a_test = lambda {',
	'    assert True',
	'}',
	'',
	'test_func_1 = lambda {',
	'    assert func("b") == "b"',
	'}',
	'',
	'a = 1',
].join('\n');

suite('KCL test discovery', () => {
	test('finds the same cases as the language server code lens', () => {
		const cases = findTestCases(CODE_LENS_FIXTURE);
		assert.deepStrictEqual(cases.map((testCase) => testCase.name), ['test_func_0', 'test_func_1']);
		assert.deepStrictEqual(span(cases[0]), { startLine: 4, endLine: 6, nameEnd: 'test_func_0'.length });
		assert.deepStrictEqual(span(cases[1]), { startLine: 12, endLine: 14, nameEnd: 'test_func_1'.length });
	});

	test('cursor inside a lambda selects that test', () => {
		const filePath = path.join('pkg', 'hello_test.k');
		const inside = planCursorTest(filePath, CODE_LENS_FIXTURE, cursor(5, 4));
		assert.ok(inside.ok);
		if (inside.ok) {
			assert.deepStrictEqual(inside.plan.names, ['test_func_0']);
			assert.deepStrictEqual(inside.plan.args, ['test', '.', '--run', '^test_func_0$']);
			assert.strictEqual(inside.plan.cwd, path.dirname(filePath));
			assert.strictEqual(inside.plan.title, 'test test_func_0');
		}

		const between = planCursorTest(filePath, CODE_LENS_FIXTURE, cursor(7, 0));
		assert.strictEqual(between.ok, false);

		const otherLambda = planCursorTest(filePath, CODE_LENS_FIXTURE, cursor(9, 4));
		assert.strictEqual(otherLambda.ok, false);
	});

	test('a selected test name runs that test', () => {
		const filePath = path.join('pkg', 'hello_test.k');
		const planned = planCursorTest(filePath, CODE_LENS_FIXTURE, {
			startLine: 4,
			startCharacter: 0,
			endLine: 4,
			endCharacter: 'test_func_0'.length,
			text: 'test_func_0',
		});
		assert.ok(planned.ok);
		if (planned.ok) {
			assert.deepStrictEqual(planned.plan.names, ['test_func_0']);
		}
	});

	test('a selection covering two tests runs both, anchored so prefixes do not match', () => {
		const filePath = path.join('pkg', 'hello_test.k');
		const planned = planCursorTest(filePath, CODE_LENS_FIXTURE, {
			startLine: 4,
			startCharacter: 0,
			endLine: 14,
			endCharacter: 1,
			text: 'test_func_0 ... test_func_1',
		});
		assert.ok(planned.ok);
		if (planned.ok) {
			assert.deepStrictEqual(planned.plan.names, ['test_func_0', 'test_func_1']);
			assert.strictEqual(planned.plan.args[3], '^(?:test_func_0|test_func_1)$');
			assert.strictEqual(planned.plan.title, 'test hello_test.k');
		}
		const pattern = new RegExp(runPattern(['test_func']));
		assert.strictEqual(pattern.test('test_func'), true);
		assert.strictEqual(pattern.test('test_func_0'), false);
	});

	test('file command limits --run to tests in that file', () => {
		const filePath = path.join('pkg', 'hello_test.k');
		const planned = planFileTests(filePath, CODE_LENS_FIXTURE);
		assert.ok(planned.ok);
		if (planned.ok) {
			assert.deepStrictEqual(planned.plan.names, ['test_func_0', 'test_func_1']);
			assert.strictEqual(planned.plan.args[0], 'test');
			assert.strictEqual(planned.plan.args[1], '.');
			assert.strictEqual(planned.plan.args[2], '--run');
		}
	});

	test('code lens name is passed through as an anchored --run pattern', () => {
		const planned = planNamedTest(path.join('pkg', 'hello_test.k'), 'test_func_0');
		assert.ok(planned.ok);
		if (planned.ok) {
			assert.deepStrictEqual(planned.plan.args, ['test', '.', '--run', '^test_func_0$']);
		}
		const rejected = planNamedTest(path.join('pkg', 'hello_test.k'), 'test_a|test_b');
		assert.strictEqual(rejected.ok, false);
	});

	test('only *_test.k files that kcl test would load are accepted', () => {
		assert.strictEqual(isKclTestFile('hello_test.k'), true);
		assert.strictEqual(isKclTestFile(path.join('pkg', 'hello_test.k')), true);
		assert.strictEqual(isKclTestFile('hello.k'), false);
		assert.strictEqual(isKclTestFile('_helper_test.k'), false);
		assert.strictEqual(planNamedTest('hello.k', 'test_func').ok, false);
		assert.strictEqual(planNamedTest('_helper_test.k', 'test_func').ok, false);
	});

	test('ignores indented, commented, and non-lambda assignments', () => {
		const source = [
			'schema S:',
			'    test_hidden = lambda {',
			'        assert True',
			'    }',
			'# test_comment = lambda {',
			'#     assert False',
			'# }',
			'test_value = 1',
			'test_real = lambda {',
			'    assert True',
			'}',
		].join('\n');
		assert.deepStrictEqual(findTestCases(source).map((testCase) => testCase.name), ['test_real']);
	});

	test('braces in strings, comments, and nested lambdas stay inside the test', () => {
		const source = [
			'test_braces = lambda {',
			'    s = "}"',
			'    # }',
			'    t = """',
			'}',
			'"""',
			'    inner = lambda {',
			'        assert True',
			'    }',
			'}',
			'test_next = lambda { assert True }',
		].join('\n');
		const cases = findTestCases(source);
		assert.deepStrictEqual(cases.map((testCase) => testCase.name), ['test_braces', 'test_next']);
		assert.strictEqual(cases[0].endLine, 9);
		assert.strictEqual(cases[1].startLine, 10);
		assert.strictEqual(cases[1].endLine, 10);
	});

	test('typed lambda signatures open the body at the real brace', () => {
		const source = [
			'test_typed = lambda x: str -> str {',
			'    x',
			'}',
			'test_dict = lambda x: {str: int} {',
			'    x',
			'}',
			'test_split = lambda x: str ->',
			'{str: int} {',
			'    x',
			'}',
		].join('\n');
		const cases = findTestCases(source);
		assert.deepStrictEqual(cases.map((testCase) => [testCase.name, testCase.startLine, testCase.endLine]), [
			['test_typed', 0, 2],
			['test_dict', 3, 5],
			['test_split', 6, 9],
		]);
	});

	test('crlf suites and a dict before the test still discover the test', () => {
		const source = 'config = {\r\n    a = 1\r\n}\r\n\r\ntest_after = lambda {\r\n    assert True\r\n}\r\n';
		const cases = findTestCases(source);
		assert.deepStrictEqual(cases.map((testCase) => testCase.name), ['test_after']);
		const planned = planCursorTest('after_test.k', source, cursor(cases[0].startLine + 1, 4));
		assert.ok(planned.ok);
		if (planned.ok) {
			assert.deepStrictEqual(planned.plan.names, ['test_after']);
		}
	});

	test('package.json contributes the code lens command and the context menu', () => {
		const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../..', 'package.json'), 'utf8'));
		const commands = manifest.contributes.commands.map((command: { command: string }) => command.command);
		assert.ok(commands.includes(RUN_TEST_COMMAND));
		assert.ok(commands.includes(RUN_FILE_TESTS_COMMAND));
		const context = manifest.contributes.menus['editor/context'];
		assert.ok(context.some((item: { command: string }) => item.command === RUN_TEST_COMMAND));
		assert.ok(context.some((item: { command: string }) => item.command === RUN_FILE_TESTS_COMMAND));
		assert.ok(manifest.activationEvents.includes(`onCommand:${RUN_TEST_COMMAND}`));
		assert.ok(manifest.activationEvents.includes(`onCommand:${RUN_FILE_TESTS_COMMAND}`));
	});
});

function span(testCase: TestCase): { startLine: number; endLine: number; nameEnd: number } {
	return { startLine: testCase.startLine, endLine: testCase.endLine, nameEnd: testCase.nameEnd };
}

function cursor(line: number, character: number) {
	return {
		startLine: line,
		startCharacter: character,
		endLine: line,
		endCharacter: character,
		text: '',
	};
}
