/**
 * Type definitions for the merged symbol index
 */

/**
 * Represents a symbol entry in the index
 */
export interface SymbolIndexEntry {
  /**
   * Name of the symbol
   */
  name: string;

  /**
   * Type of the symbol
   */
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'enum' | 'other';

  /**
   * Path to the file containing the symbol
   */
  filePath: string;

  /**
   * Location of the symbol in the file
   */
  location: { 
    line: number; 
    character: number; 
  };

  /**
   * Generated docstring for the symbol
   */
  docstring: string;

  /**
   * Original code snippet
   */
  snippet: string;

  /**
   * Symbols that depend on this symbol
   */
  dependents: DependentInfo[];

  /**
   * Symbols that this symbol depends on
   */
  depends_on: DependencyInfo[];
}

/**
 * Information about a symbol that depends on another symbol
 */
export interface DependentInfo {
  /**
   * Name of the dependent symbol
   */
  name: string;

  /**
   * Path to the file containing the dependent symbol
   */
  filePath: string;

  /**
   * Line number where the dependency occurs
   */
  line: number;

  /**
   * Code context around the dependency
   */
  contextSnippet?: string;
}

/**
 * Information about a symbol that this symbol depends on
 */
export interface DependencyInfo {
  /**
   * Name of the symbol being depended on
   */
  name: string;

  /**
   * Path to the file containing the symbol being depended on
   */
  filePath: string;

  /**
   * Line number where the dependency occurs
   */
  line: number;
}

/**
 * The complete symbol index structure
 * Organized by file path for easier lookup
 */
export interface SymbolIndex {
  /**
   * Map of file paths to arrays of symbol entries
   */
  [filePath: string]: SymbolIndexEntry[];
} 