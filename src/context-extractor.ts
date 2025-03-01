import { ContextFileService } from '@/features/context-extractor/context-file-service';
import { RelevantInfoService } from '@/features/context-extractor/relevant-info-service';
import { SymbolIndexAnalyzer } from '@/features/context-extractor/symbol-index-analyzer';

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
export const generateRelevantInfo = async (
  rootPath: string,
  contextFiles: string[],
): Promise<void> => {
  await RelevantInfoService.generateRelevantInfo(rootPath, contextFiles);
};

// Find files matching pattern, useful for file discovery
export const findFilesMatchingPattern = ContextFileService.findFilesMatchingPattern;

// Export the SymbolIndexAnalyzer for direct use
export { SymbolIndexAnalyzer }; 