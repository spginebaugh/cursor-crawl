import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { WorkspaceService, showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { getIgnoredPatterns, ensureOpenAIApiKey } from '@/shared/utils/project-analysis';
import { resumeDocstringGeneration } from '@/features/generate-docstring/generate-docstring';

/**
 * Registers the resume docstring generation command
 * @param context - VS Code extension context for registration
 */
export const registerResumeDocstringGenerationCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.resumeDocstringGeneration', async () => {
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
            'Resuming Docstring Generation',
            async (progress) => {
                try {
                    // Get ignored patterns from .gitignore
                    const ignoredPatterns = await getIgnoredPatterns(workspaceFolder);
                    
                    // Resume docstring generation for the existing symbol index (only for empty docstrings)
                    await resumeDocstringGeneration(workspaceFolder, ignoredPatterns, progress);
                    
                    showInformationMessage('Docstring generation resumed and completed successfully.');
                } catch (error) {
                    console.error('Error resuming docstring generation:', error);
                    showErrorMessage('Error resuming docstring generation', error);
                }
            }
        );
    });

    context.subscriptions.push(command);
}; 