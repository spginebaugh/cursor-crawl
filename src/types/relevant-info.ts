/**
 * Represents the filtered information relevant to specific context files
 */
export interface RelevantInfo {
  /**
   * The dependency information relevant to the context files
   */
  dependencies: {
    /**
     * Map of file paths to their dependency information
     */
    files: Record<string, FileDependencyInfo>;
  };
  
  /**
   * The symbol information relevant to the context files
   */
  symbols: {
    /**
     * Map of symbol identifiers to their detailed information
     */
    symbols: Record<string, SymbolInfo>;
  };
  
  /**
   * The context files that were referenced in the prompt
   */
  contextFiles: string[];
}

// Import types from the new consolidated type files
import { FileDependencyInfo } from './dependency-map';
import { SymbolIndexEntry as SymbolInfo } from './symbol-index'; 