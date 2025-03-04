import * as fs from 'fs-extra';
import * as path from 'path';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';

// Output directory and file for the symbol index
const OUTPUT_DIR = '.cursorcrawl';
const OUTPUT_FILE = 'symbol-index.json';

/**
 * Service for handling file I/O operations related to docstring generation
 */
export const FileIoService = {
  /**
   * Writes a debug file with the list of symbols that need docstrings
   * @param rootPath - Project root path
   * @param symbolIndex - Symbol index to analyze
   * @param isEmptyDocstring - Function to determine if a docstring is empty
   */
  writeSymbolsNeedingDocstrings: async (
    rootPath: string,
    symbolIndex: SymbolIndex,
    isEmptyDocstring: (docstring?: string) => boolean
  ): Promise<void> => {
    try {
      const symbolsNeedingDocstrings: Array<{
        filePath: string;
        name: string;
        type: string;
        docstring: string | undefined;
      }> = [];
      
      // Gather all symbols needing docstrings
      for (const filePath in symbolIndex) {
        const fileSymbols = symbolIndex[filePath];
        
        for (const symbol of fileSymbols) {
          if (isEmptyDocstring(symbol.docstring)) {
            symbolsNeedingDocstrings.push({
              filePath,
              name: symbol.name,
              type: symbol.type,
              docstring: symbol.docstring
            });
          }
        }
      }
      
      // Write to a debug file
      const debugFilePath = path.join(rootPath, OUTPUT_DIR, 'symbols-needing-docstrings.json');
      await fs.writeFile(debugFilePath, JSON.stringify(symbolsNeedingDocstrings, null, 2), 'utf8');
      
      console.log(`Wrote list of ${symbolsNeedingDocstrings.length} symbols needing docstrings to ${debugFilePath}`);
    } catch (error) {
      console.error('Error writing debug file:', error);
    }
  },

  /**
   * Reads a file's content from disk
   * @param filePath - Path to the file to read
   * @returns The file content as a string
   */
  readFileContent: async (filePath: string): Promise<string> => {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }
}; 