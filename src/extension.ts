// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';

// Import commands
import {
	registerAnalyzeCommand,
	registerBuildSymbolIndexCommand,
	registerGenerateDocstringIndexCommand,
	registerGenerateDocstringIndexParallelCommand,
	registerExtractContextCommand,
	registerResumeDocstringGenerationCommand
} from '@/commands';

// Import file watcher
import { setupFileWatcher } from '@/features/file-watcher';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "cursorcrawl" is now active!');

	// Register commands
	registerAnalyzeCommand(context);
	registerBuildSymbolIndexCommand(context);
	registerGenerateDocstringIndexCommand(context);
	registerGenerateDocstringIndexParallelCommand(context);
	registerExtractContextCommand(context);
	registerResumeDocstringGenerationCommand(context);
	
	// Initialize file watcher
	setupFileWatcher(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
