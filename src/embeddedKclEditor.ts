import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	CompletionRequest,
	DefinitionRequest,
	HoverRequest,
	LanguageClient,
} from 'vscode-languageclient/node';
import {
	EmbeddedKclRegion,
	classifyKclLine,
	findEmbeddedKclRegions,
	hostPositionToVirtual,
	indentInsertedText,
	regionAt,
	renderVirtualDocument,
	virtualPositionToHost,
} from './embeddedKcl';
import { kclCompletionItems } from './kclCompletions';

/**
 * Embedded KCL is analyzed as a standalone `.k` file because kcl-language-server
 * only accepts file URIs. The file lives outside the workspace so it is not part
 * of a `kcl.mod` package. Imports that depend on a nearby module may not resolve.
 */
const VIRTUAL_DIR = path.join(os.tmpdir(), 'vscode-kcl-embedded');
const TOKEN_LEGEND = new vscode.SemanticTokensLegend(['keyword', 'type', 'string', 'number', 'comment']);

export interface EmbeddedLanguageHost {
	getClient(): LanguageClient | undefined;
	ensureClient(prompt: boolean): Promise<void>;
}

interface VirtualSlot {
	host: vscode.Uri;
	index: number;
	region: EmbeddedKclRegion;
	uri: vscode.Uri;
}

const slotsByHostIndex = new Map<string, VirtualSlot>();
const slotsByUri = new Map<string, VirtualSlot>();
const diagnosticsByUri = new Map<string, vscode.Diagnostic[]>();
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let hostApi: EmbeddedLanguageHost | undefined;
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function isEmbeddedVirtualUri(uri: vscode.Uri): boolean {
	return lookupSlot(uri) !== undefined;
}

export function redirectEmbeddedDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[], next: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => void): void {
	const slot = lookupSlot(uri);
	if (!slot) {
		next(uri, diagnostics);
		return;
	}
	const mapped = diagnostics
		.map(diagnostic => mapDiagnostic(uri, diagnostic, slot))
		.filter((diagnostic): diagnostic is vscode.Diagnostic => Boolean(diagnostic));
	diagnosticsByUri.set(slot.uri.toString(), mapped);
	publishHostDiagnostics(slot.host);
}

export function registerEmbeddedKcl(context: vscode.ExtensionContext, host: EmbeddedLanguageHost): void {
	hostApi = host;
	diagnosticCollection = vscode.languages.createDiagnosticCollection('kcl-embedded');
	context.subscriptions.push(diagnosticCollection);

	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
		{ language: 'yaml' },
		{ provideDocumentSemanticTokens },
		TOKEN_LEGEND,
	));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
		{ language: 'yaml' },
		{ provideCompletionItems },
		'.',
	));
	context.subscriptions.push(vscode.languages.registerHoverProvider(
		{ language: 'yaml' },
		{ provideHover },
	));
	context.subscriptions.push(vscode.languages.registerDefinitionProvider(
		{ language: 'yaml' },
		{ provideDefinition },
	));

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
		if (document.languageId === 'yaml') {
			scheduleSync(document);
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
		if (event.document.languageId === 'yaml') {
			scheduleSync(event.document);
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
		if (document.languageId === 'yaml') {
			void clearHost(document.uri);
		}
	}));

	for (const document of vscode.workspace.textDocuments) {
		if (document.languageId === 'yaml') {
			scheduleSync(document);
		}
	}
}

export async function disposeEmbeddedKcl(): Promise<void> {
	for (const timer of syncTimers.values()) {
		clearTimeout(timer);
	}
	syncTimers.clear();
	const hosts = new Set<string>();
	for (const slot of slotsByHostIndex.values()) {
		hosts.add(slot.host.toString());
	}
	for (const host of hosts) {
		await clearHost(vscode.Uri.parse(host));
	}
	diagnosticCollection?.dispose();
	diagnosticCollection = undefined;
}

function provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
	const builder = new vscode.SemanticTokensBuilder(TOKEN_LEGEND);
	const regions = findEmbeddedKclRegions(document.getText()).filter(region => region.kind === 'kcl-input');
	const lines = document.getText().split(/\r?\n/);
	for (const region of regions) {
		for (let line = region.contentStartLine; line < region.contentEndLine && line < lines.length; line++) {
			for (const token of classifyKclLine(lines[line])) {
				builder.push(new vscode.Range(line, token.start, line, token.start + token.length), token.type);
			}
		}
	}
	return builder.build();
}

async function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | undefined> {
	const region = regionAt(findEmbeddedKclRegions(document.getText()), position.line);
	if (!region) {
		return undefined;
	}
	const local = kclCompletionItems().map(item => retargetCompletion(item, region));
	const remote = await languageServerCompletions(document, position, region, context, token);
	const seen = new Set(remote.map(completionLabel));
	return [...remote, ...local.filter(item => !seen.has(completionLabel(item)))];
}

async function provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
	const located = await locateVirtual(document, position);
	if (!located) {
		return undefined;
	}
	const client = hostApi?.getClient();
	if (!client) {
		return undefined;
	}
	try {
		const hover = await client.sendRequest(HoverRequest.type, {
			textDocument: { uri: client.code2ProtocolConverter.asUri(located.uri) },
			position: client.code2ProtocolConverter.asPosition(located.position),
		}, token);
		if (!hover) {
			return undefined;
		}
		const converted = client.protocol2CodeConverter.asHover(hover);
		if (!converted) {
			return undefined;
		}
		if (converted.range) {
			converted.range = shiftRange(converted.range, located.region);
		}
		return converted;
	} catch {
		return undefined;
	}
}

async function provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
	const located = await locateVirtual(document, position);
	if (!located) {
		return undefined;
	}
	const client = hostApi?.getClient();
	if (!client) {
		return undefined;
	}
	try {
		const definition = await client.sendRequest(DefinitionRequest.type, {
			textDocument: { uri: client.code2ProtocolConverter.asUri(located.uri) },
			position: client.code2ProtocolConverter.asPosition(located.position),
		}, token);
		if (!definition) {
			return undefined;
		}
		const converted = await client.protocol2CodeConverter.asDefinitionResult(definition);
		return mapDefinition(converted, located.uri, located.region, document.uri);
	} catch {
		return undefined;
	}
}

async function languageServerCompletions(document: vscode.TextDocument, position: vscode.Position, region: EmbeddedKclRegion, context: vscode.CompletionContext, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
	const located = await locateVirtual(document, position);
	const client = hostApi?.getClient();
	if (!located || !client) {
		return [];
	}
	try {
		const triggerKind = context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter ? 2 : 1;
		const result = await client.sendRequest(CompletionRequest.type, {
			textDocument: { uri: client.code2ProtocolConverter.asUri(located.uri) },
			position: client.code2ProtocolConverter.asPosition(located.position),
			context: {
				triggerKind,
				triggerCharacter: context.triggerCharacter,
			},
		}, token);
		const converted = await client.protocol2CodeConverter.asCompletionResult(result);
		const items = Array.isArray(converted) ? converted : converted?.items ?? [];
		return items.map(item => retargetCompletion(item, region));
	} catch {
		return [];
	}
}

async function locateVirtual(document: vscode.TextDocument, position: vscode.Position): Promise<{ uri: vscode.Uri; position: vscode.Position; region: EmbeddedKclRegion } | undefined> {
	const regions = findEmbeddedKclRegions(document.getText());
	const region = regionAt(regions, position.line);
	if (!region) {
		return undefined;
	}
	const virtual = hostPositionToVirtual(position.line, position.character, region);
	if (!virtual) {
		return undefined;
	}
	await hostApi?.ensureClient(false);
	if (!hostApi?.getClient()) {
		return undefined;
	}
	const index = regions.indexOf(region);
	const uri = await ensureVirtual(document, region, index);
	return { uri, position: new vscode.Position(virtual.line, virtual.character), region };
}

function scheduleSync(document: vscode.TextDocument): void {
	const key = document.uri.toString();
	const pending = syncTimers.get(key);
	if (pending) {
		clearTimeout(pending);
	}
	syncTimers.set(key, setTimeout(() => {
		syncTimers.delete(key);
		void syncDocument(document);
	}, 200));
}

async function syncDocument(document: vscode.TextDocument): Promise<void> {
	if (document.languageId !== 'yaml') {
		return;
	}
	const regions = findEmbeddedKclRegions(document.getText());
	if (regions.length === 0) {
		await clearHost(document.uri);
		return;
	}
	await hostApi?.ensureClient(false);
	if (!hostApi?.getClient()) {
		return;
	}
	const used = new Set<number>();
	for (let index = 0; index < regions.length; index++) {
		await ensureVirtual(document, regions[index], index);
		used.add(index);
	}
	for (const slot of [...slotsByHostIndex.values()]) {
		if (slot.host.toString() === document.uri.toString() && !used.has(slot.index)) {
			await removeSlot(slot);
		}
	}
	publishHostDiagnostics(document.uri);
}

async function ensureVirtual(document: vscode.TextDocument, region: EmbeddedKclRegion, index: number): Promise<vscode.Uri> {
	const file = virtualFilePath(document.uri, index);
	const text = renderVirtualDocument(document.getText(), region);
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	const uri = vscode.Uri.file(file);
	const slot: VirtualSlot = { host: document.uri, index, region, uri };
	registerSlot(slot);
	const open = vscode.workspace.textDocuments.find(item => item.uri.fsPath === file);
	if (!open) {
		await fs.promises.writeFile(file, text, 'utf8');
		await vscode.workspace.openTextDocument(uri);
		return uri;
	}
	if (open.getText() !== text) {
		const edit = new vscode.WorkspaceEdit();
		const last = open.lineAt(Math.max(0, open.lineCount - 1)).range.end;
		edit.replace(uri, new vscode.Range(0, 0, last.line, last.character), text);
		await vscode.workspace.applyEdit(edit);
		if (open.isDirty) {
			await open.save();
		}
	}
	return uri;
}

async function clearHost(host: vscode.Uri): Promise<void> {
	for (const slot of [...slotsByHostIndex.values()]) {
		if (slot.host.toString() === host.toString()) {
			await removeSlot(slot);
		}
	}
	diagnosticCollection?.delete(host);
}

async function removeSlot(slot: VirtualSlot): Promise<void> {
	slotsByHostIndex.delete(slotKey(slot.host, slot.index));
	slotsByUri.delete(slot.uri.toString());
	slotsByUri.delete(slot.uri.fsPath);
	diagnosticsByUri.delete(slot.uri.toString());
	await fs.promises.rm(slot.uri.fsPath, { force: true }).catch(() => undefined);
}

function registerSlot(slot: VirtualSlot): void {
	slotsByHostIndex.set(slotKey(slot.host, slot.index), slot);
	slotsByUri.set(slot.uri.toString(), slot);
	slotsByUri.set(slot.uri.fsPath, slot);
}

function lookupSlot(uri: vscode.Uri): VirtualSlot | undefined {
	return slotsByUri.get(uri.toString()) ?? slotsByUri.get(uri.fsPath);
}

function slotKey(host: vscode.Uri, index: number): string {
	return `${host.toString()}#${index}`;
}

function virtualFilePath(host: vscode.Uri, index: number): string {
	const hash = crypto.createHash('sha1').update(host.toString()).digest('hex').slice(0, 12);
	return path.join(VIRTUAL_DIR, `${hash}-${index}.k`);
}

function publishHostDiagnostics(host: vscode.Uri): void {
	const merged: vscode.Diagnostic[] = [];
	const seen = new Set<string>();
	for (const slot of slotsByHostIndex.values()) {
		if (slot.host.toString() !== host.toString() || seen.has(slot.uri.toString())) {
			continue;
		}
		seen.add(slot.uri.toString());
		merged.push(...(diagnosticsByUri.get(slot.uri.toString()) ?? []));
	}
	diagnosticCollection?.set(host, merged);
}

function mapDiagnostic(virtualUri: vscode.Uri, diagnostic: vscode.Diagnostic, slot: VirtualSlot): vscode.Diagnostic | undefined {
	if (diagnostic.range.start.line < slot.region.contentStartLine || diagnostic.range.start.line >= slot.region.contentEndLine) {
		return undefined;
	}
	const mapped = new vscode.Diagnostic(shiftRange(diagnostic.range, slot.region), diagnostic.message, diagnostic.severity);
	mapped.source = diagnostic.source || 'kcl';
	mapped.code = diagnostic.code;
	if (diagnostic.relatedInformation) {
		mapped.relatedInformation = diagnostic.relatedInformation.map(info => {
			if (!sameUri(info.location.uri, virtualUri)) {
				return info;
			}
			return new vscode.DiagnosticRelatedInformation(
				new vscode.Location(slot.host, shiftRange(info.location.range, slot.region)),
				info.message,
			);
		});
	}
	return mapped;
}

function mapDefinition(result: vscode.Definition | vscode.LocationLink[] | undefined, virtualUri: vscode.Uri, region: EmbeddedKclRegion, host: vscode.Uri): vscode.Definition | vscode.LocationLink[] | undefined {
	if (!result) {
		return undefined;
	}
	if (Array.isArray(result)) {
		if (result.length > 0 && 'targetUri' in result[0]) {
			return (result as vscode.LocationLink[]).map(link => mapDefinitionItem(link, virtualUri, region, host) as vscode.LocationLink);
		}
		return (result as vscode.Location[]).map(location => mapLocation(location, virtualUri, region, host));
	}
	return mapLocation(result, virtualUri, region, host);
}

function mapDefinitionItem(item: vscode.Location | vscode.LocationLink, virtualUri: vscode.Uri, region: EmbeddedKclRegion, host: vscode.Uri): vscode.Location | vscode.LocationLink {
	if ('targetUri' in item) {
		const link = item;
		const targetIsVirtual = sameUri(link.targetUri, virtualUri);
		return {
			...link,
			targetUri: targetIsVirtual ? host : link.targetUri,
			targetRange: targetIsVirtual ? shiftRange(link.targetRange, region) : link.targetRange,
			targetSelectionRange: targetIsVirtual && link.targetSelectionRange ? shiftRange(link.targetSelectionRange, region) : link.targetSelectionRange,
			originSelectionRange: link.originSelectionRange ? shiftRange(link.originSelectionRange, region) : undefined,
		};
	}
	return mapLocation(item, virtualUri, region, host);
}

function mapLocation(location: vscode.Location, virtualUri: vscode.Uri, region: EmbeddedKclRegion, host: vscode.Uri): vscode.Location {
	if (!sameUri(location.uri, virtualUri)) {
		return location;
	}
	return new vscode.Location(host, shiftRange(location.range, region));
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
	return left.toString() === right.toString() || left.fsPath === right.fsPath;
}

function shiftRange(range: vscode.Range, region: EmbeddedKclRegion): vscode.Range {
	const start = virtualPositionToHost(range.start.line, range.start.character, region);
	const end = virtualPositionToHost(range.end.line, range.end.character, region);
	return new vscode.Range(start.line, start.character, end.line, end.character);
}

function retargetCompletion(item: vscode.CompletionItem, region: EmbeddedKclRegion): vscode.CompletionItem {
	if (typeof item.insertText === 'string') {
		item.insertText = indentInsertedText(item.insertText, region.indent);
	} else if (item.insertText instanceof vscode.SnippetString) {
		item.insertText = new vscode.SnippetString(indentInsertedText(item.insertText.value, region.indent));
	}
	if (item.range instanceof vscode.Range) {
		item.range = shiftRange(item.range, region);
	} else if (item.range) {
		item.range = {
			inserting: shiftRange(item.range.inserting, region),
			replacing: shiftRange(item.range.replacing, region),
		};
	}
	if (item.additionalTextEdits) {
		item.additionalTextEdits = item.additionalTextEdits.map(edit => new vscode.TextEdit(
			shiftRange(edit.range, region),
			indentInsertedText(edit.newText, region.indent),
		));
	}
	return item;
}

function completionLabel(item: vscode.CompletionItem): string {
	return typeof item.label === 'string' ? item.label : item.label.label;
}
