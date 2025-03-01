import * as path from 'path';
import { FileSystemService } from '@/shared/services/file-system-service';

/**
 * Service for handling context file operations
 */
export const ContextFileService = {
  /**
   * Extracts context file references from a prompt string
   * @param prompt The prompt text to analyze
   * @returns Array of file paths referenced in the prompt
   */
  extractContextFiles(prompt: string): string[] {
    // Match @filename.ext patterns in the prompt
    const fileMatches = prompt.match(/@[\w.\/-]+/g);
    
    if (!fileMatches) {
      return [];
    }
    
    // Remove @ prefix and deduplicate
    return [...new Set(fileMatches.map(match => match.substring(1).trim()))];
  },

  /**
   * Finds all files matching a pattern (using glob matching)
   * @param rootPath The root path of the project
   * @param pattern The pattern to match against
   * @returns Array of file paths that match the pattern
   */
  async findFilesMatchingPattern(rootPath: string, pattern: string): Promise<string[]> {
    // Handle exact file paths
    if (pattern.includes('.') && !pattern.includes('*')) {
      // Try with exact path
      const exactPath = path.join(rootPath, pattern);
      const fs = await import('fs-extra');
      if (await fs.pathExists(exactPath)) {
        return [pattern];
      }
      
      // Try searching for the file name in the project
      const fileName = path.basename(pattern);
      const files = await FileSystemService.getProjectFiles(rootPath);
      
      return files
        .filter(file => path.basename(file) === fileName)
        .map(file => path.relative(rootPath, file));
    }
    
    // Handle wildcard patterns
    const extension = pattern.includes('.') ? path.extname(pattern) : '.ts';
    const files = await FileSystemService.getProjectFiles(rootPath);
    const filteredFiles = files.filter(file => path.extname(file) === extension);
    
    // Convert glob pattern to regex
    const regexPattern = new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*'));
    
    return filteredFiles
      .filter(file => regexPattern.test(file))
      .map(file => path.relative(rootPath, file));
  },

  /**
   * Finds all matching files based on an array of patterns
   * @param rootPath The root path of the project
   * @param filePatterns Array of patterns to match against
   * @returns Array of file paths that match any of the patterns
   */
  async findAllMatchingFiles(rootPath: string, filePatterns: string[]): Promise<string[]> {
    const allMatchingFiles: string[] = [];
    
    for (const pattern of filePatterns) {
      const matchingFiles = await this.findFilesMatchingPattern(rootPath, pattern);
      allMatchingFiles.push(...matchingFiles);
    }
    
    // Remove duplicates
    return [...new Set(allMatchingFiles)];
  },

  /**
   * Unified method to extract file references from prompt and resolve them to actual files
   * @param prompt The prompt text to analyze
   * @param rootPath The root path of the project
   * @returns Promise resolving to a list of validated file paths
   */
  async extractAndResolveContextFiles(
    prompt: string,
    rootPath: string
  ): Promise<string[]> {
    // Step 1: Extract file patterns from the prompt
    const filePatterns = this.extractContextFiles(prompt);
    
    if (filePatterns.length === 0) {
      return [];
    }
    
    // Step 2: Resolve patterns to actual files and validate their existence
    const resolvedFiles = await this.findAllMatchingFiles(rootPath, filePatterns);
    
    return resolvedFiles;
  }
}; 