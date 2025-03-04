import * as fs from 'fs-extra';
import * as path from 'path';
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';

// Constants
const CODEBASE_CONTEXT_FILENAME = 'codebase-context.json';

/**
 * Type definition for a streamlined symbol entry without extra context data
 */
export interface CodebaseContextEntry {
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
   * Generated docstring for the symbol
   */
  docstring: string;
}

/**
 * The streamlined codebase context structure
 * Organized by file path for easier lookup
 */
export interface CodebaseContext {
  /**
   * Map of file paths to arrays of streamlined symbol entries
   */
  [filePath: string]: CodebaseContextEntry[];
}

/**
 * Service for handling codebase context operations
 */
export const CodebaseContextService = {
  /**
   * Gets the path to the codebase context file
   * @param rootPath - The workspace root path
   * @returns The path to the codebase context file
   */
  getCodebaseContextPath(rootPath: string): string {
    return path.join(rootPath, '.cursorcrawl', CODEBASE_CONTEXT_FILENAME);
  },

  /**
   * Converts a symbol index entry to a streamlined context entry
   * @param entry - The symbol index entry
   * @returns The streamlined context entry
   */
  convertToContextEntry(entry: SymbolIndexEntry): CodebaseContextEntry {
    return {
      name: entry.name,
      type: entry.type,
      filePath: entry.filePath,
      docstring: entry.docstring
    };
  },

  /**
   * Converts a full symbol index to a streamlined codebase context
   * @param symbolIndex - The full symbol index
   * @returns The streamlined codebase context
   */
  convertToCodebaseContext(symbolIndex: SymbolIndex): CodebaseContext {
    const codebaseContext: CodebaseContext = {};
    
    for (const [filePath, entries] of Object.entries(symbolIndex)) {
      codebaseContext[filePath] = entries.map(entry => this.convertToContextEntry(entry));
    }
    
    return codebaseContext;
  },

  /**
   * Generates the codebase context from the symbol index
   * @param rootPath - The workspace root path
   * @returns The streamlined codebase context
   */
  async generateCodebaseContext(rootPath: string): Promise<CodebaseContext> {
    // Read the symbol index
    const symbolIndex = await SymbolIndexService.getSymbolIndexOrThrow(
      rootPath,
      'Symbol index not found. Please build it first using the "Build Symbol Index" command.'
    );
    
    // Convert it to a streamlined context
    return this.convertToCodebaseContext(symbolIndex);
  },

  /**
   * Writes the codebase context to disk
   * @param rootPath - The workspace root path
   * @param codebaseContext - The codebase context to write
   * @returns The path to the written file
   */
  async writeCodebaseContext(rootPath: string, codebaseContext: CodebaseContext): Promise<string> {
    return WorkspaceService.writeCursorCrawlFile(rootPath, CODEBASE_CONTEXT_FILENAME, codebaseContext);
  },

  /**
   * Generates and writes the codebase context
   * @param rootPath - The workspace root path
   * @returns The path to the written file
   */
  async generateAndWriteCodebaseContext(rootPath: string): Promise<string> {
    const codebaseContext = await this.generateCodebaseContext(rootPath);
    return this.writeCodebaseContext(rootPath, codebaseContext);
  }
}; 