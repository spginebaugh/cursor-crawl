import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { showErrorMessage } from '@/shared/services/workspace-service';
import { ensureProjectAnalysis } from '@/shared/utils/project-analysis';

/**
 * Registers the build symbol index command
 * @param context - VS Code extension context for registration
 */
export const registerBuildSymbolIndexCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.buildSymbolIndex', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showErrorMessage('No workspace folder open.');
            return;
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        
        await ProgressService.runWithProgress(
            'Building Symbol Index',
            async (progress) => {
                await ensureProjectAnalysis(rootPath, {
                    generateDocstrings: false,
                    showMessages: true,
                    progress
                });
            }
        );
    });

    context.subscriptions.push(command);
}; 