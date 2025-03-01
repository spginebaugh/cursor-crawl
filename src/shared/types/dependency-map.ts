/**
 * Re-exports from symbol-index.ts for compatibility
 * The symbol-index now includes dependency information
 */

import { SymbolIndex } from './symbol-index';

/**
 * @deprecated Use the SymbolIndex type from './symbol-index' instead
 * which combines symbol and dependency information
 */
export interface DependencyMap {
  /**
   * Map of file paths to their dependency information
   */
  files: Record<string, FileDependencyInfo>;
}

/**
 * @deprecated Use SymbolIndexEntry[] from './symbol-index' instead
 */
export interface FileDependencyInfo {
  /**
   * Files that this file imports from (forward dependencies)
   */
  imports: ImportInfo[];
  
  /**
   * Files that import this file (reverse dependencies)
   */
  importedBy: ImportInfo[];
}

/**
 * @deprecated Use DependencyInfo/DependentInfo from './symbol-index'
 */
export interface ImportInfo {
  /**
   * Path to the file being imported from or the file importing this file
   */
  from: string;
  
  /**
   * The specific named exports being imported/exported
   */
  imports: string[];
} 