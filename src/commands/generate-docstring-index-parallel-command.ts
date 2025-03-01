import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { WorkspaceService, showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { getIgnoredPatterns, ensureOpenAIApiKey } from '@/shared/utils/project-analysis';
import { generateDocstringsParallel } from '@/features/generate-docstring/generate-docstring-parallel';

/**
 * Registers the generate docstring index parallel command
 * @param context - VS Code extension context for registration
 */
export const registerGenerateDocstringIndexParallelCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.generateDocstringIndexParallel', async () => {
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
        
        // Get the concurrency preference from settings with a default of 5
        const config = vscode.workspace.getConfiguration('cursorcrawl');
        const maxConcurrency = config.get('docstringGenerationConcurrency', 5);
        
        await ProgressService.runWithProgress(
            'Generating Docstring Index (Parallel)',
            async (progress, token) => {
                try {
                    // Get ignored patterns from .gitignore
                    const ignoredPatterns = await getIgnoredPatterns(workspaceFolder);
                    
                    // Generate docstrings in parallel for the existing symbol index
                    const success = await generateDocstringsParallel(
                        workspaceFolder, 
                        ignoredPatterns, 
                        progress, 
                        token,
                        maxConcurrency
                    );
                    
                    if (token?.isCancellationRequested) {
                        showInformationMessage('Parallel docstring generation was cancelled.');
                        return false;
                    }
                    
                    if (success) {
                        showInformationMessage(`Docstrings generated successfully using parallel processing (${maxConcurrency} concurrent files).`);
                    } else {
                        showErrorMessage('Failed to generate docstrings in parallel mode.');
                    }
                    
                    return success;
                } catch (error) {
                    console.error('Error generating docstring index in parallel:', error);
                    showErrorMessage('Error generating docstring index in parallel mode', error);
                    return false;
                }
            },
            { cancellable: true }
        );
    });

    context.subscriptions.push(command);
}; 