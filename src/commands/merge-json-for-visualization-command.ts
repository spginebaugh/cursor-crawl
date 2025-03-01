import * as vscode from 'vscode';
import { mergeJsonForVisualizationCommand } from '@/features/merge-json/merge-json-command';

/**
 * Registers the merge JSON for visualization command
 * @param context - The VS Code extension context
 */
export const registerMergeJsonForVisualizationCommand = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(mergeJsonForVisualizationCommand());
}; 