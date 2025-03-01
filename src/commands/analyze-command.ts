import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { showErrorMessage } from '@/shared/services/workspace-service';
import { ensureProjectAnalysis } from '@/shared/utils/project-analysis';

/**
 * Registers the analyze command that builds the symbol index and optionally generates docstrings
 * @param context - VS Code extension context for registration
 */
export const registerAnalyzeCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.analyze', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showErrorMessage('No workspace folder found. Please open a folder first.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        
        // Ask if docstrings should be generated
        const generateDocstrings = await vscode.window.showQuickPick(
            [
                { label: 'Yes', description: 'Build symbol index and generate docstrings' },
                { label: 'No', description: 'Build symbol index only (no AI-generated docstrings)' }
            ],
            { placeHolder: 'Would you like to generate docstrings? This requires an OpenAI API key.' }
        );
        
        if (!generateDocstrings) {
            return; // User canceled
        }
        
        await ProgressService.runWithProgress(
            'Analyzing Project',
            async (progress) => {
                await ensureProjectAnalysis(rootPath, {
                    generateDocstrings: generateDocstrings.label === 'Yes',
                    showMessages: true,
                    progress
                });
            }
        );
    });

    context.subscriptions.push(command);
}; 