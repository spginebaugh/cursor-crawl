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

// Re-export types from dependency-map and smart-symbol-index to avoid circular dependencies
import { FileDependencyInfo } from './dependency-map';
import { SymbolInfo } from './smart-symbol-index'; 