import * as vscode from 'vscode';
import { showDependencyGraphCommand, showDependencyGraphWithDuplicatesCommand } from '@/features/dependency-graph/dependency-graph-command';

/**
 * Registers the show dependency graph command
 * @param context - The VS Code extension context
 */
export const registerShowDependencyGraphCommand = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(showDependencyGraphCommand());
  context.subscriptions.push(showDependencyGraphWithDuplicatesCommand());
}; 