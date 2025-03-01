import * as vscode from 'vscode';
import { createSymbolIndex } from '@/features/symbol-index/symbol-index';
import { generateDocstringIndex } from '@/features/generate-docstring/generate-docstring';
import { FileSystemService } from '@/shared/services/file-system-service';
import { WorkspaceService, showInformationMessage, showErrorMessage } from '@/shared/services/workspace-service';
import { OpenAiService } from '@/shared/services/openai-service';
import { ProjectService } from '@/shared/services/project-service';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { SymbolIndexOrchestrator } from '@/features/symbol-index/symbol-index-orchestrator';

/**
 * Type definition for project analysis options
 */
export interface ProjectAnalysisOptions {
    generateDocstrings?: boolean;
    showMessages?: boolean;
    progress?: vscode.Progress<{ message: string }>;
    incremental?: boolean;
    changedFile?: string;
    symbolIndexCache?: SymbolIndex;
}

/**
 * Ensures the .cursortest directory exists and setup is complete
 * @param rootPath - The workspace root path
 * @returns Whether the operation was successful
 */
export async function ensureProjectSetup(rootPath: string): Promise<boolean> {
    try {
        await WorkspaceService.ensureCursorTestDir(rootPath);
        return true;
    } catch (error) {
        console.error('Error setting up project directory:', error);
        return false;
    }
}

/**
 * Gets the ignored patterns from .gitignore
 * @param rootPath - The workspace root path
 * @returns List of ignored patterns
 */
export async function getIgnoredPatterns(rootPath: string): Promise<string[]> {
    return await FileSystemService.parseGitignore(rootPath);
}

/**
 * Generates and saves the project tree
 * @param rootPath - The workspace root path
 * @param ignoredPatterns - Patterns to ignore
 * @param progress - Optional progress reporter
 * @returns Whether the operation was successful
 */
export async function generateProjectTreeFile(
    rootPath: string,
    ignoredPatterns: string[],
    progress?: vscode.Progress<{ message: string }>
): Promise<boolean> {
    try {
        progress?.report({ message: 'Generating project tree...' });
        const treeContent = await ProjectService.generateProjectTree(rootPath, ignoredPatterns);
        await WorkspaceService.writeCursorTestFile(rootPath, 'project-tree.mdc', `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`);
        return true;
    } catch (error) {
        console.error('Error generating project tree:', error);
        return false;
    }
}

/**
 * Builds or updates the symbol index
 * @param rootPath - The workspace root path
 * @param ignoredPatterns - Patterns to ignore
 * @param options - Symbol index options
 * @returns The generated/updated symbol index
 */
export async function buildSymbolIndex(
    rootPath: string,
    ignoredPatterns: string[],
    options: {
        progress?: vscode.Progress<{ message: string }>;
        incremental?: boolean;
        changedFile?: string;
        symbolIndexCache?: SymbolIndex;
    } = {}
): Promise<SymbolIndex | null> {
    try {
        const { progress, incremental = false, changedFile, symbolIndexCache } = options;
        
        progress?.report({ message: 'Building symbol index...' });
        
        if (incremental && symbolIndexCache && changedFile) {
            return await SymbolIndexOrchestrator.updateSymbolIndex(
                rootPath,
                symbolIndexCache,
                changedFile,
                ignoredPatterns
            );
        } else {
            return await SymbolIndexOrchestrator.createSymbolIndex(rootPath, ignoredPatterns, progress);
        }
    } catch (error) {
        console.error('Error building symbol index:', error);
        return null;
    }
}

/**
 * Checks for and handles OpenAI API key requirement for docstring generation
 * @param rootPath - The workspace root path
 * @param showMessages - Whether to show UI messages
 * @returns Whether the API key is available
 */
export async function ensureOpenAIApiKey(
    rootPath: string,
    showMessages: boolean
): Promise<boolean> {
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    if (envVars.OPENAI_API_KEY) {
        return true;
    }
    
    if (showMessages) {
        const setKey = await vscode.window.showErrorMessage(
            'OpenAI API key not found. Would you like to set it now?',
            'Yes', 'No'
        );
        
        if (setKey === 'Yes') {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenAI API Key',
                password: true,
                ignoreFocusOut: true
            });
            
            if (apiKey) {
                await vscode.workspace.getConfiguration('cursorcrawl').update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Generates docstrings for symbols in the index
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore
 * @param progress - Optional progress reporter
 * @param token - Optional cancellation token
 * @returns Whether the operation was successful
 */
export async function generateDocstrings(
    rootPath: string,
    ignoredPatterns: string[],
    progress?: vscode.Progress<{ message: string }>,
    token?: vscode.CancellationToken
): Promise<boolean> {
    try {
        progress?.report({ message: 'Generating docstrings...' });
        await generateDocstringIndex(rootPath, ignoredPatterns, progress, token);
        return true;
    } catch (error) {
        console.error('Error generating docstrings:', error);
        return false;
    }
}

/**
 * Shows appropriate messages based on analysis results
 * @param showMessages - Whether to show messages
 * @param withDocstrings - Whether docstrings were generated
 */
export function showAnalysisMessages(
    showMessages: boolean,
    withDocstrings: boolean
): void {
    if (!showMessages) {return;}
    
    if (withDocstrings) {
        showInformationMessage('Project analysis completed successfully with docstrings!');
    } else {
        showInformationMessage('Project analysis completed successfully (without docstrings).');
    }
}

/**
 * Ensures project analysis artifacts are generated and up-to-date
 * @param rootPath - The workspace root path
 * @param options - Optional configuration
 * @returns Whether the operation was successful and the symbol index if available
 */
export async function ensureProjectAnalysis(
    rootPath: string,
    options: ProjectAnalysisOptions = {}
): Promise<{ success: boolean; symbolIndex: SymbolIndex | null }> {
    const { 
        generateDocstrings: shouldGenerateDocstrings = false, 
        showMessages = true, 
        progress,
        incremental = false,
        changedFile,
        symbolIndexCache
    } = options;
    
    try {
        // Step 1: Setup project directory
        const setupSuccess = await ensureProjectSetup(rootPath);
        if (!setupSuccess) {throw new Error('Failed to setup project directory');}
        
        // Step 2: Get ignored patterns
        const ignoredPatterns = await getIgnoredPatterns(rootPath);
        
        // Step 3: Generate project tree
        await generateProjectTreeFile(rootPath, ignoredPatterns, progress);
        
        // Step 4: Build symbol index
        const symbolIndex = await buildSymbolIndex(rootPath, ignoredPatterns, {
            progress,
            incremental,
            changedFile,
            symbolIndexCache
        });
        
        if (!symbolIndex) {throw new Error('Failed to build symbol index');}
        
        // Step 5: Optionally generate docstrings
        let docsGenerated = false;
        if (shouldGenerateDocstrings) {
            const apiKeyAvailable = await ensureOpenAIApiKey(rootPath, showMessages);
            
            if (apiKeyAvailable) {
                docsGenerated = await generateDocstrings(rootPath, ignoredPatterns, progress);
            }
        }
        
        // Step 6: Show appropriate messages
        showAnalysisMessages(showMessages, docsGenerated);
        
        return { success: true, symbolIndex };
    } catch (error) {
        console.error('Error in project analysis:', error);
        if (showMessages) {
            showErrorMessage('Error generating project analysis', error);
        }
        return { success: false, symbolIndex: null };
    }
} 