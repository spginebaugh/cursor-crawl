import * as vscode from 'vscode';
import * as path from 'path';
import { ProgressService } from '@/shared/services/progress-service';
import { WorkspaceService, showErrorMessage, showInformationMessage } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { generateRelevantInfo , extractAndResolveContextFiles } from '@/context-extractor';


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

        // Check if symbol index exists
        if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
            const response = await vscode.window.showErrorMessage(
                'Symbol index not found. Would you like to run analysis first?',
                'Yes', 'No'
            );
            
            if (response === 'Yes') {
                // Run analysis first
                await vscode.commands.executeCommand('cursorcrawl.analyze');
            } else {
                return;
            }
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
                    progress.report({ message: "Identifying and resolving file references..." });
                    
                    // Extract and resolve context files from the prompt in one unified step
                    const contextFiles = await extractAndResolveContextFiles(promptText, workspaceFolder);
                    
                    if (contextFiles.length === 0) {
                        showInformationMessage('No file references found in prompt. Please use @filename.ts syntax to reference files.');
                        return;
                    }
                    
                    progress.report({ message: `Found ${contextFiles.length} referenced files. Generating relevant information...` });
                    
                    // Generate the relevant-info.json file
                    await generateRelevantInfo(workspaceFolder, contextFiles);
                    
                    progress.report({ message: "Context information extracted successfully!" });
                    
                    // Show the relevant files that were found
                    showInformationMessage(
                        `Successfully extracted context for ${contextFiles.length} files: ${contextFiles.slice(0, 3).join(', ')}${contextFiles.length > 3 ? '...' : ''}`
                    );
                    
                    // Open the relevant-info.json file in the editor
                    const relevantInfoPath = path.join(WorkspaceService.getCursorTestDir(workspaceFolder), 'relevant-info.json');
                    const document = await vscode.workspace.openTextDocument(relevantInfoPath);
                    await vscode.window.showTextDocument(document);
                }
            );
        } catch (error) {
            showErrorMessage(`Error extracting context: ${error}`);
        }
    });

    context.subscriptions.push(command);
}; 