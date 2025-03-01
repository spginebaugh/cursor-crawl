import * as ts from 'typescript';

// Import types and services
import {
  SymbolIndex
} from '@/shared/types/symbol-index';
import { SymbolIndexOrchestrator } from '@/features/symbol-index/symbol-index-orchestrator';

/**
 * Creates a complete symbol index for a project
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 * @returns The complete symbol index
 */
export const createSymbolIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: { report: (info: { message: string }) => void }
): Promise<SymbolIndex> => {
  return SymbolIndexOrchestrator.createSymbolIndex(rootPath, ignoredPatterns, progress);
};

/**
 * Extracts JSDoc comment from a node if present
 * @param node - The TypeScript node
 * @param sourceFile - The source file
 * @returns The JSDoc comment text or empty string
 */
const extractJSDocComment = (node: ts.Node, sourceFile: ts.SourceFile): string => {
  const jsDocComments = ts.getJSDocCommentsAndTags(node) as ts.JSDoc[];
  
  if (jsDocComments && jsDocComments.length > 0) {
    // Get the first JSDoc comment
    const jsDoc = jsDocComments[0];
    
    // Extract the JSDoc text
    if (jsDoc.getFullText) {
      return jsDoc.getFullText(sourceFile);
    }
  }
  
  return '';
};

/**
 * Updates the symbol index for a changed file
 * @param rootPath - Project root path
 * @param existingIndex - The existing symbol index
 * @param changedFilePath - Path to the changed file
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @returns The updated symbol index
 */
export const updateSymbolIndex = async (
  rootPath: string,
  existingIndex: SymbolIndex,
  changedFilePath: string,
  ignoredPatterns: string[] = []
): Promise<SymbolIndex> => {
  return SymbolIndexOrchestrator.updateSymbolIndex(
    rootPath,
    existingIndex,
    changedFilePath,
    ignoredPatterns
  );
}; 