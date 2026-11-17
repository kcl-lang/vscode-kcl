import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	classifyKclLine,
	findEmbeddedKclRegions,
	hostPositionToVirtual,
	indentInsertedText,
	regionAt,
	renderVirtualDocument,
	virtualPositionToHost,
} from '../../embeddedKcl';

const CROSSPLANE = `apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: kcl-function
spec:
  pipeline:
    - step: render
      input:
        apiVersion: krm.kcl.dev/v1alpha1
        kind: KCLInput
        metadata:
          annotations:
            "krm.kcl.dev/default_ready": "True"
        spec:
          target: Resources
          source: |
            oxr = option("params").oxr
            items = [
              oxr
            ]
    - step: ready
      input:
        kind: Other
        spec:
          source: |
            echo hello
`;

suite('Embedded KCL', () => {
	test('detects a Crossplane KCLInput source block and ignores the next one', () => {
		const regions = findEmbeddedKclRegions(CROSSPLANE);
		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].kind, 'kcl-input');
		const virtual = renderVirtualDocument(CROSSPLANE, regions[0]);
		const lines = virtual.split('\n');
		assert.strictEqual(lines.length, CROSSPLANE.split('\n').length);
		assert.strictEqual(lines[regions[0].contentStartLine], 'oxr = option("params").oxr');
		assert.strictEqual(lines[regions[0].contentStartLine + 1], 'items = [');
		assert.strictEqual(lines[regions[0].contentStartLine + 2], '  oxr');
		assert.strictEqual(lines[regions[0].contentStartLine + 3], ']');
		assert.strictEqual(lines[0], '');
		assert.ok(!virtual.includes('echo hello'));
	});

	test('does not treat a plain source block or an OCI source as KCL', () => {
		const text = `data:\n  source: |\n    echo hello\n  name: app\nkind: KCLInput\nspec:\n  source: oci://example/app\n  target: Resources\n`;
		assert.deepStrictEqual(findEmbeddedKclRegions(text), []);
	});

	test('opts in with a # kcl header comment', () => {
		const text = `outer:\n  script: |- # kcl\n    schema Name:\n      name: str\n\n    x = 1\n  other: value\n  run: >- # KCL\n    if True:\n      a = 1\n  after: 1\n`;
		const regions = findEmbeddedKclRegions(text);
		assert.strictEqual(regions.length, 2);
		assert.ok(regions.every(region => region.kind === 'marker'));
		const first = renderVirtualDocument(text, regions[0]).split('\n');
		assert.strictEqual(first[regions[0].contentStartLine], 'schema Name:');
		assert.strictEqual(first[regions[0].contentStartLine + 1], '  name: str');
		assert.strictEqual(first[regions[0].contentStartLine + 2], '');
		assert.strictEqual(first[regions[0].contentStartLine + 3], 'x = 1');
		assert.strictEqual(regionAt(regions, regions[0].headerLine), undefined);
		assert.strictEqual(regionAt(regions, regions[0].contentStartLine), regions[0]);
	});

	test('does not treat # kclanguage as a marker', () => {
		const text = 'run: | # kclanguage\n  schema Name:\n';
		assert.deepStrictEqual(findEmbeddedKclRegions(text), []);
	});

	test('closes a list-item KCLInput at the next list item', () => {
		const text = [
			'pipeline:',
			'  - kind: KCLInput',
			'    spec:',
			'      source: |',
			'        a = 1',
			'  - kind: Pod',
			'    spec:',
			'      source: |',
			'        echo',
		].join('\n');
		const regions = findEmbeddedKclRegions(text);
		assert.strictEqual(regions.length, 1);
		assert.strictEqual(renderVirtualDocument(text, regions[0]).split('\n')[regions[0].contentStartLine], 'a = 1');
	});

	test('finds each KCLInput in a multi-document file', () => {
		const text = 'kind: KCLInput\nspec:\n  source: |\n    a = 1\n---\nkind: KCLInput\nspec:\n  source: |\n    b = 2\n';
		const regions = findEmbeddedKclRegions(text);
		assert.strictEqual(regions.length, 2);
		assert.strictEqual(renderVirtualDocument(text, regions[0]).split('\n')[regions[0].contentStartLine], 'a = 1');
		assert.strictEqual(renderVirtualDocument(text, regions[1]).split('\n')[regions[1].contentStartLine], 'b = 2');
	});

	test('keeps quoted KCLInput and stops at a document separator', () => {
		const text = 'kind: "KCLInput"\nspec:\n  source: |\n    b = 2\n---\nkind: ConfigMap\ndata:\n  source: |\n    echo\n';
		const regions = findEmbeddedKclRegions(text);
		assert.strictEqual(regions.length, 1);
		assert.strictEqual(renderVirtualDocument(text, regions[0]).split('\n')[regions[0].contentStartLine], 'b = 2');
	});

	test('preserves line numbers for CRLF text and maps positions', () => {
		const text = 'kind: KCLInput\r\nspec:\r\n  source: |\r\n    value = 1\r\n';
		const regions = findEmbeddedKclRegions(text);
		assert.strictEqual(regions.length, 1);
		const virtual = renderVirtualDocument(text, regions[0]);
		assert.strictEqual(virtual.split('\n')[regions[0].contentStartLine], 'value = 1');
		const host = { line: regions[0].contentStartLine, character: regions[0].indent + 3 };
		const virtualPos = hostPositionToVirtual(host.line, host.character, regions[0]);
		assert.deepStrictEqual(virtualPos, { line: host.line, character: 3 });
		assert.deepStrictEqual(virtualPositionToHost(virtualPos!.line, virtualPos!.character, regions[0]), host);
		assert.strictEqual(hostPositionToVirtual(0, 0, regions[0]), undefined);
	});

	test('indents inserted continuation lines for the YAML block', () => {
		assert.strictEqual(indentInsertedText('schema Name:\n    ', 4), 'schema Name:\n        ');
		assert.strictEqual(indentInsertedText('import ', 4), 'import ');
	});

	test('classifies KCL tokens without marking words inside strings or comments', () => {
		const tokens = classifyKclLine('    schema Name:  # keep');
		assert.deepStrictEqual(tokens.map(token => token.type), ['keyword', 'comment']);
		const literal = classifyKclLine('    name: str = "schema True"');
		assert.deepStrictEqual(literal.map(token => token.type), ['type', 'string']);
		const number = classifyKclLine('    count = -12.5');
		assert.deepStrictEqual(number.filter(token => token.type === 'number').map(token => '    count = -12.5'.slice(token.start, token.start + token.length)), ['-12.5']);
	});

	test('contribution injects the KCL grammar into YAML', () => {
		const root = path.resolve(__dirname, '../../..');
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		const grammar = pkg.contributes.grammars.find((item: { scopeName?: string }) => item.scopeName === 'source.yaml.kcl-injection');
		assert.ok(grammar);
		assert.deepStrictEqual(grammar.injectTo, ['source.yaml']);
		assert.strictEqual(grammar.embeddedLanguages['meta.embedded.block.kcl'], 'KCL');
		assert.ok(pkg.activationEvents.includes('onLanguage:yaml'));
		const source = JSON.parse(fs.readFileSync(path.join(root, grammar.path), 'utf8'));
		assert.strictEqual(source.scopeName, 'source.yaml.kcl-injection');
		assert.ok(JSON.stringify(source).includes('source.kcl'));
		assert.ok(JSON.stringify(source).includes('meta.embedded.block.kcl'));
	});
});
