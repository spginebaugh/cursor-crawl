import * as fs from 'fs-extra';
import * as path from 'path';
import { RelevantInfo } from '@/shared/types/relevant-info';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { FileSystemService } from '@/shared/services/file-system-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { ContextFileService } from '@/features/context-extractor/context-file-service';
import { SymbolIndexAnalyzer } from './symbol-index-analyzer';

/**
 * Service for generating and managing relevant information
 */
export const RelevantInfoService = {
  /**
   * Gets the path to the relevant info file
   * @param rootPath The workspace root path
   * @returns The path to the relevant info file
   */
  getRelevantInfoPath(rootPath: string): string {
    return path.join(rootPath, '.cursortest', 'relevant-info.json');
  },

  /**
   * Reads the relevant info from disk
   * @param rootPath The workspace root path
   * @returns The relevant info, or undefined if it doesn't exist
   */
  async readRelevantInfo(rootPath: string): Promise<RelevantInfo | undefined> {
    try {
      const infoPath = this.getRelevantInfoPath(rootPath);
      
      if (!await fs.pathExists(infoPath)) {
        return undefined;
      }
      
      const content = await fs.readFile(infoPath, 'utf8');
      return JSON.parse(content) as RelevantInfo;
    } catch (error) {
      console.error('Error reading relevant info:', error);
      return undefined;
    }
  },

  /**
   * Writes the relevant info to disk
   * @param rootPath The workspace root path
   * @param relevantInfo The relevant info to write
   */
  async writeRelevantInfo(rootPath: string, relevantInfo: RelevantInfo): Promise<void> {
    try {
      await WorkspaceService.ensureCursorTestDir(rootPath);
      const infoPath = this.getRelevantInfoPath(rootPath);
      await fs.writeFile(infoPath, JSON.stringify(relevantInfo, null, 2), 'utf8');
    } catch (error) {
      console.error('Error writing relevant info:', error);
    }
  },

  /**
   * Generates relevant information based on context files
   * @param rootPath The root path of the project
   * @param contextFiles Array of already-verified file paths from the workspace
   * @returns The generated relevant information
   */
  async generateRelevantInfo(
    rootPath: string,
    contextFiles: string[],
  ): Promise<RelevantInfo> {
    // Load symbol index
    const symbolIndex = await this.loadSymbolIndex(rootPath);
    
    // Files are already resolved and validated
    const matchingFiles = contextFiles;
    
    // Extract relevant information for each file
    const relevantInfo = await this.buildRelevantInfo(rootPath, matchingFiles, symbolIndex);
    
    // Write relevant info to file
    await this.writeRelevantInfo(rootPath, relevantInfo);
    
    return relevantInfo;
  },

  /**
   * Loads the symbol index from disk
   * @param rootPath The workspace root path
   * @returns The symbol index
   */
  async loadSymbolIndex(rootPath: string): Promise<SymbolIndex> {
    try {
      const symbolIndex = await SymbolIndexService.readSymbolIndex(rootPath);
      if (!symbolIndex) {
        return {};
      }
      return symbolIndex;
    } catch (error) {
      console.error('Error loading symbol index:', error);
      return {};
    }
  },

  /**
   * Builds the relevant information structure from the context files
   * @param rootPath The root path of the project
   * @param contextFiles Array of file paths that are referenced in the prompt
   * @param symbolIndex The symbol index
   * @returns The built relevant information
   */
  async buildRelevantInfo(
    rootPath: string,
    contextFiles: string[],
    symbolIndex: SymbolIndex
  ): Promise<RelevantInfo> {
    const relevantInfo: RelevantInfo = {
      files: {},
      dependencyGraph: {}
    };
    
    // Process the symbol index using the SymbolIndexAnalyzer
    const analysisResult = SymbolIndexAnalyzer.analyzeSymbolIndex(symbolIndex, contextFiles);
    
    // Assign dependency graph
    relevantInfo.dependencyGraph = analysisResult.dependencyInfo;
    
    for (const filePath of contextFiles) {
      if (!FileSystemService.isAnalyzableFile(filePath)) {
        continue;
      }
      
      try {
        // Extract file content with context
        const content = await this.extractSourceWithContext(rootPath, filePath);
        
        // Get symbols for this file from the filtered index
        const fileSymbols = analysisResult.filteredIndex[filePath] || [];
        
        // Add file information to the relevant info
        relevantInfo.files[filePath] = {
          content,
          symbols: fileSymbols
        };
      } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
      }
    }
    
    return relevantInfo;
  },
  
  /**
   * Extracts source file content with context
   * @param rootPath The root path of the project
   * @param filePath The file path
   * @returns The source file content with context
   */
  async extractSourceWithContext(
    rootPath: string,
    filePath: string
  ): Promise<string> {
    try {
      const fs = await import('fs-extra');
      const absolutePath = path.join(rootPath, filePath);
      
      if (await fs.pathExists(absolutePath)) {
        return await fs.readFile(absolutePath, 'utf8');
      }
      
      return '';
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return '';
    }
  }
}; 