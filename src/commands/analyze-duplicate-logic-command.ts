import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
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
                    
                    // Step 2: Analyze codebase for duplicate logic in chunks
                    progress.report({ message: 'Starting analysis...' });
                    
                    // Analyze with progress reports
                    const filePath = await DuplicateLogicAnalyzerService.analyzeDuplicateLogic(
                        rootPath,
                        (progressMessage) => {
                            progress.report({ message: progressMessage });
                        }
                    );
                    
                    // Step 3: Show results
                    progress.report({ message: 'Analysis complete.' });
                    
                    // Find all the type-specific JSON files
                    const cursorCrawlDir = path.join(rootPath, '.cursorcrawl');
                    const typeFiles = (await fs.readdir(cursorCrawlDir))
                        .filter(file => file.startsWith('duplicate-analysis-') && file.endsWith('.json'))
                        .map(file => path.join(cursorCrawlDir, file));
                    
                    // Create a summary message
                    let summaryMessage = `Duplicate logic analysis completed successfully.\n\n`;
                    summaryMessage += `Combined results: ${filePath}\n`;
                    
                    if (typeFiles.length > 0) {
                        summaryMessage += `\nType-specific results:\n`;
                        for (const typeFile of typeFiles) {
                            const typeName = path.basename(typeFile).replace('duplicate-analysis-', '').replace('.json', '');
                            summaryMessage += `- ${typeName}: ${typeFile}\n`;
                        }
                        
                        // Add instructions for viewing the files
                        summaryMessage += `\nYou can open these files from the File Explorer or use the "Open Type-Specific Results" option.`;
                    }
                    
                    // Show success message with file locations
                    const openTypeSpecific = 'Open Type-Specific Results';
                    const userChoice = await vscode.window.showInformationMessage(
                        summaryMessage,
                        { modal: false },
                        openTypeSpecific
                    );
                    
                    // Open the combined JSON file first
                    const mainFileUri = vscode.Uri.file(filePath);
                    await vscode.window.showTextDocument(mainFileUri);
                    
                    // If user wants to open type-specific files
                    if (userChoice === openTypeSpecific && typeFiles.length > 0) {
                        // Create a quick pick to select which type file to open
                        const items = typeFiles.map(file => {
                            const typeName = path.basename(file).replace('duplicate-analysis-', '').replace('.json', '');
                            return {
                                label: typeName,
                                description: file,
                                file
                            };
                        });
                        
                        const selectedItem = await vscode.window.showQuickPick(items, {
                            placeHolder: 'Select a type-specific results file to open'
                        });
                        
                        if (selectedItem) {
                            const fileUri = vscode.Uri.file(selectedItem.file);
                            await vscode.window.showTextDocument(fileUri);
                        }
                    }
                    
                } catch (error) {
                    showErrorMessage('Failed to analyze codebase for duplicate logic', error);
                    throw error;
                }
            }
        );
    });

    context.subscriptions.push(command);
}; 