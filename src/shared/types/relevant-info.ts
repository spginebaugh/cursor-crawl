/**
 * Represents the filtered information relevant to specific context files
 */
export interface RelevantInfo {
  /**
   * Map of file paths to their content and symbols
   */
  files: Record<string, FileContentInfo>;
  
  /**
   * The dependency graph information for all context files
   */
  dependencyGraph: Record<string, FileImportInfo>;
}

// Import types from symbol-index.ts
import { SymbolIndexEntry } from './symbol-index';

/**
 * Contains file import and export relationship information
 */
export interface FileImportInfo {
  /**
   * Files that this file imports from (forward dependencies)
   */
  imports: { from: string; imports: string[] }[];
  
  /**
   * Files that import this file (reverse dependencies)
   */
  importedBy: { from: string; imports: string[] }[];
}

/**
 * Contains file content and symbol information
 */
export interface FileContentInfo {
  /**
   * The content of the file with context
   */
  content: string;
  
  /**
   * The symbols defined in the file
   */
  symbols: SymbolIndexEntry[];
} 