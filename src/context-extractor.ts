import { ContextFileService } from '@/features/context-extractor/context-file-service';
import { RelevantInfoService } from '@/features/context-extractor/relevant-info-service';
import { SymbolIndexAnalyzer } from '@/features/context-extractor/symbol-index-analyzer';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceService } from '@/shared/services/workspace-service';

/**
 * Extracts context file references from a prompt string
 * @param promptText The prompt text to analyze
 * @returns Array of file paths referenced in the prompt
 */
export const extractContextFiles = ContextFileService.extractContextFiles;

/**
 * Extracts and resolves file references from a prompt to actual file paths
 * @param prompt The prompt text to analyze
 * @param rootPath The workspace root path
 * @returns Promise resolving to array of valid file paths
 */
export const extractAndResolveContextFiles = ContextFileService.extractAndResolveContextFiles;

/**
 * Generates relevant information based on context files
 * @param rootPath The root path of the project
 * @param contextFiles Array of already-verified file paths from the workspace
 * @returns The filtered relevant information
 */
export const generateRelevantInfo = RelevantInfoService.generateRelevantInfo;

/**
 * Executes the complete context extraction workflow
 * @param promptText The prompt text with file references
 * @param workspaceFolder The workspace folder path
 * @returns Object containing result details: success status, message, context files, and relevant info path
 */
export const executeContextExtraction = async (
  promptText: string,
  workspaceFolder: string
): Promise<{
  success: boolean;
  message: string;
  contextFiles?: string[];
  relevantInfoPath?: string;
}> => {
  try {
    // Check if symbol index exists
    if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
      return {
        success: false,
        message: 'Symbol index not found. Please run analysis first.'
      };
    }

    // Extract and resolve context files from the prompt
    const contextFiles = await extractAndResolveContextFiles(promptText, workspaceFolder);
    
    if (contextFiles.length === 0) {
      return {
        success: false,
        message: 'No file references found in prompt. Please use @filename.ts syntax to reference files.'
      };
    }
    
    // Generate the relevant-info.json file
    await RelevantInfoService.generateRelevantInfo(workspaceFolder, contextFiles);
    
    // Get path to the generated file
    const relevantInfoPath = path.join(WorkspaceService.getCursorTestDir(workspaceFolder), 'relevant-info.json');
    
    return {
      success: true,
      message: `Successfully extracted context for ${contextFiles.length} files: ${contextFiles.slice(0, 3).join(', ')}${contextFiles.length > 3 ? '...' : ''}`,
      contextFiles,
      relevantInfoPath
    };
  } catch (error) {
    return {
      success: false,
      message: `Error executing context extraction: ${error}`
    };
  }
};

// Find files matching pattern, useful for file discovery
export const findFilesMatchingPattern = ContextFileService.findFilesMatchingPattern;

// Export the SymbolIndexAnalyzer for direct use
export { SymbolIndexAnalyzer }; 