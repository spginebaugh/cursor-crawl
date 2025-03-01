import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { ProjectService } from '@/shared/services/project-service';
import { showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { DuplicateLogicAnalyzerService } from '@/features/docstring-analyzer/duplicate-logic-analyzer';

/**
 * Registers the analyze duplicate logic command
 * @param context - VS Code extension context for registration
 */
export const registerAnalyzeDuplicateLogicCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.analyzeDuplicateLogic', async () => {
        // Initialize the workspace with required services
        const result = await ProjectService.initializeWorkspace({
            checkOpenAi: true,
            requireOpenAi: true,
            validateSymbolIndex: true
        });
        
        if (!result.rootPath) {
            return;
        }
        
        const rootPath = result.rootPath;
        
        await ProgressService.runWithProgress(
            'Analyzing Codebase for Duplicate Logic',
            async (progress) => {
                try {
                    // Step 1: Verify codebase context exists
                    progress.report({ message: 'Checking codebase context...' });
                    
                    // Check if codebase context file exists
                    try {
                        await DuplicateLogicAnalyzerService.readCodebaseContext(rootPath);
                    } catch (error) {
                        // If not, prompt to generate it
                        const generateResponse = await vscode.window.showErrorMessage(
                            'Codebase context not found. Would you like to generate it first?',
                            'Yes', 'No'
                        );
                        
                        if (generateResponse === 'Yes') {
                            // Generate codebase context first
                            await vscode.commands.executeCommand('cursorcrawl.generateCodebaseContext');
                        } else {
                            throw new Error('Codebase context is required for analysis');
                        }
                    }
                    
                    // Step 2: Analyze codebase for duplicate logic
                    progress.report({ message: 'Analyzing codebase for duplicate logic (this may take a while)...' });
                    const filePath = await DuplicateLogicAnalyzerService.analyzeDuplicateLogic(rootPath);
                    
                    // Step 3: Show results
                    progress.report({ message: 'Analysis complete.' });
                    
                    // Show success message with file location
                    showInformationMessage(`Duplicate logic analysis completed successfully at ${filePath}`);
                    
                    // Open the CSV file
                    const fileUri = vscode.Uri.file(filePath);
                    await vscode.window.showTextDocument(fileUri);
                    
                } catch (error) {
                    showErrorMessage('Failed to analyze codebase for duplicate logic', error);
                    throw error;
                }
            }
        );
    });

    context.subscriptions.push(command);
}; 