import * as vscode from 'vscode';
import { ProgressService } from '@/shared/services/progress-service';
import { WorkspaceService, showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { executeContextExtraction } from '@/context-extractor';


/**
 * Registers the extract context command
 * @param context - VS Code extension context for registration
 */
export const registerExtractContextCommand = (context: vscode.ExtensionContext): void => {
    const command = vscode.commands.registerCommand('cursorcrawl.extractContext', async () => {
        const workspaceFolder = WorkspaceService.getWorkspaceFolder();
        if (!workspaceFolder) {
            showErrorMessage('No workspace folder found. Please open a folder first.');
            return;
        }

        // Show input box for the prompt
        const promptText = await vscode.window.showInputBox({
            placeHolder: 'Enter your prompt with file references using @filename.ts syntax',
            prompt: 'Files referenced with @ will be included as context',
            ignoreFocusOut: true
        });
        
        if (!promptText) {
            return; // User cancelled
        }
        
        try {
            // Show progress indicator
            await ProgressService.runWithProgress(
                "Extracting Context Information",
                async (progress) => {
                    progress.report({ message: "Processing prompt and extracting context..." });
                    
                    // Execute the context extraction workflow
                    const result = await executeContextExtraction(promptText, workspaceFolder);
                    
                    if (!result.success) {
                        // Handle specific error case for missing symbol index
                        if (result.message.includes('Symbol index not found')) {
                            const response = await vscode.window.showErrorMessage(
                                'Symbol index not found. Would you like to run analysis first?',
                                'Yes', 'No'
                            );
                            
                            if (response === 'Yes') {
                                // Run analysis first
                                await vscode.commands.executeCommand('cursorcrawl.analyze');
                                
                                // Try extraction again after analysis
                                progress.report({ message: "Re-attempting context extraction after analysis..." });
                                const retryResult = await executeContextExtraction(promptText, workspaceFolder);
                                
                                if (!retryResult.success) {
                                    showErrorMessage(retryResult.message);
                                    return;
                                }
                                
                                // Update result with retry result if successful
                                Object.assign(result, retryResult);
                            } else {
                                return;
                            }
                        } else {
                            showErrorMessage(result.message);
                            return;
                        }
                    }
                    
                    // Show success message
                    showInformationMessage(result.message);
                    
                    // Open the relevant-info.json file in the editor
                    if (result.relevantInfoPath) {
                        const document = await vscode.workspace.openTextDocument(result.relevantInfoPath);
                        await vscode.window.showTextDocument(document);
                    }
                }
            );
        } catch (error) {
            showErrorMessage(`Error extracting context: ${error}`);
        }
    });

    context.subscriptions.push(command);
}; 