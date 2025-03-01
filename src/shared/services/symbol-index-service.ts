import * as fs from 'fs-extra';
import * as path from 'path';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { WorkspaceService } from '@/shared/services/workspace-service';

// Constants
const SYMBOL_INDEX_FILENAME = 'symbol-index.json';

/**
 * Service for handling symbol index operations
 */
export const SymbolIndexService = {
  /**
   * Gets the path to the symbol index file
   * @param rootPath - The workspace root path
   * @returns The path to the symbol index file
   */
  getSymbolIndexPath(rootPath: string): string {
    return path.join(rootPath, '.cursortest', SYMBOL_INDEX_FILENAME);
  },

  /**
   * Reads the symbol index from disk
   * @param rootPath - The workspace root path
   * @returns The symbol index, or undefined if it doesn't exist
   */
  async readSymbolIndex(rootPath: string): Promise<SymbolIndex | undefined> {
    try {
      const indexPath = this.getSymbolIndexPath(rootPath);
      
      if (!await fs.pathExists(indexPath)) {
        return undefined;
      }
      
      const content = await fs.readFile(indexPath, 'utf8');
      return JSON.parse(content) as SymbolIndex;
    } catch (error) {
      console.error('Error reading symbol index:', error);
      return undefined;
    }
  },

  /**
   * Writes the symbol index to disk
   * @param rootPath - The workspace root path
   * @param symbolIndex - The symbol index to write
   */
  async writeSymbolIndex(rootPath: string, symbolIndex: SymbolIndex): Promise<void> {
    try {
      await WorkspaceService.ensureCursorTestDir(rootPath);
      const indexPath = this.getSymbolIndexPath(rootPath);
      await fs.writeJson(indexPath, symbolIndex, { spaces: 2 });
      console.log(`Symbol index written to ${indexPath}`);
    } catch (error) {
      console.error('Error writing symbol index:', error);
      throw error;
    }
  },

  /**
   * Checks if the symbol index exists
   * @param rootPath - The workspace root path
   * @returns Whether the symbol index exists
   */
  async symbolIndexExists(rootPath: string): Promise<boolean> {
    const indexPath = this.getSymbolIndexPath(rootPath);
    return fs.pathExists(indexPath);
  },

  /**
   * Gets the symbol index, reading it from disk if needed
   * Either returns the symbol index or throws an error
   * @param rootPath - The workspace root path
   * @param errorMessage - Optional custom error message when index doesn't exist
   * @returns The symbol index
   * @throws Error if the symbol index doesn't exist
   */
  async getSymbolIndexOrThrow(
    rootPath: string,
    errorMessage: string = 'Symbol index not found'
  ): Promise<SymbolIndex> {
    const symbolIndex = await this.readSymbolIndex(rootPath);
    
    if (!symbolIndex) {
      throw new Error(errorMessage);
    }
    
    return symbolIndex;
  }
}; 