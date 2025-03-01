import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { WorkspaceService, showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { getIgnoredPatterns, generateDocstrings, ensureOpenAIApiKey } from '@/shared/utils/project-analysis';

/**
 * Registers the generate docstring index command
 * @param context - VS Code extension context for registration
 */
export const registerGenerateDocstringIndexCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.generateDocstringIndex', async () => {
        const workspaceFolder = WorkspaceService.getWorkspaceFolder();
        if (!workspaceFolder) {
            showErrorMessage('No workspace folder open.');
            return;
        }
        
        // Ensure OpenAI API key is available
        const apiKeyAvailable = await ensureOpenAIApiKey(workspaceFolder, true);
        if (!apiKeyAvailable) {
            return;
        }
        
        // Check if symbol index exists
        if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
            const response = await vscode.window.showErrorMessage(
                'Symbol index not found. Would you like to build the symbol index first?',
                'Yes', 'No'
            );
            
            if (response === 'Yes') {
                // Run build symbol index first
                await vscode.commands.executeCommand('cursorcrawl.buildSymbolIndex');
            } else {
                return;
            }
        }
        
        await ProgressService.runWithProgress(
            'Generating Docstring Index',
            async (progress) => {
                try {
                    // Get ignored patterns from .gitignore
                    const ignoredPatterns = await getIgnoredPatterns(workspaceFolder);
                    
                    // Generate docstrings for the existing symbol index
                    const success = await generateDocstrings(workspaceFolder, ignoredPatterns, progress);
                    
                    if (success) {
                        showInformationMessage('Docstrings generated successfully.');
                    } else {
                        showErrorMessage('Failed to generate docstrings.');
                    }
                } catch (error) {
                    console.error('Error generating docstring index:', error);
                    showErrorMessage('Error generating docstring index', error);
                }
            }
        );
    });

    context.subscriptions.push(command);
}; 