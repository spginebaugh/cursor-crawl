/**
 * Represents the entire dependency map for a project
 */
export interface DependencyMap {
  /**
   * Map of file paths to their dependency information
   */
  files: Record<string, FileDependencyInfo>;
}

/**
 * Represents dependency information for a single file
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
 * Represents a specific import relationship
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