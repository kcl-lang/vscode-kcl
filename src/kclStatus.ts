import * as vscode from 'vscode';

// kcl status bar shows kcl language server state, the kcl tools install/update notifaction, etc.

export const outputChannel = vscode.window.createOutputChannel('KCL');
