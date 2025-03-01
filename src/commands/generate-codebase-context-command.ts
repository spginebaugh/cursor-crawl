import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { CodebaseContextService } from '@/features/docstring-analyzer/codebase-context-generator';

/**
 * Registers the generate codebase context command
 * @param context - VS Code extension context for registration
 */
export const registerGenerateCodebaseContextCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.generateCodebaseContext', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showErrorMessage('No workspace folder open.');
            return;
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        
        await ProgressService.runWithProgress(
            'Generating Codebase Context',
            async (progress) => {
                try {
                    progress.report({ message: 'Reading symbol index...' });
                    
                    progress.report({ message: 'Generating codebase context...' });
                    const filePath = await CodebaseContextService.generateAndWriteCodebaseContext(rootPath);
                    
                    showInformationMessage(`Codebase context generated successfully at ${filePath}`);
                } catch (error) {
                    showErrorMessage('Failed to generate codebase context', error);
                    throw error;
                }
            }
        );
    });

    context.subscriptions.push(command);
}; 