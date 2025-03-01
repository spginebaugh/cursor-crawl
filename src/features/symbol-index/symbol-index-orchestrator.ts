import * as path from 'path';
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { FileSystemService, MAX_FILES_TO_PROCESS } from '@/shared/services/file-system-service';
import { SymbolExtractionService } from '@/features/symbol-index/symbol-extraction-service';
import { DependencyResolverService } from '@/features/symbol-index/dependency-resolver-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';

/**
 * Service that orchestrates the symbol indexing process
 */
export const SymbolIndexOrchestrator = {
  /**
   * Creates a complete symbol index for a project
   * @param rootPath - Path to the project root
   * @param ignoredPatterns - Patterns to ignore during file processing
   * @param progress - Optional progress reporter
   * @returns The complete symbol index
   */
  async createSymbolIndex(
    rootPath: string,
    ignoredPatterns: string[] = [],
    progress?: { report: (info: { message: string }) => void }
  ): Promise<SymbolIndex> {
    try {
      progress?.report({ message: 'Analyzing project structure...' });
      
      // Get all project files
      const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
      
      // Safety check - limit number of files to process
      if (projectFiles.length > MAX_FILES_TO_PROCESS) {
        console.warn(`Project contains ${projectFiles.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
        projectFiles.length = MAX_FILES_TO_PROCESS;
      }
      
      // First check if there's an existing symbol index to preserve docstrings
      const existingSymbolIndex = await SymbolIndexService.readSymbolIndex(rootPath);
      
      // Initialize the symbol index with file-based organization
      const symbolIndex: SymbolIndex = {};
      
      // First pass: Extract all symbols and their basic information
      progress?.report({ message: 'Extracting symbols from files...' });
      for (let i = 0; i < projectFiles.length; i++) {
        const filePath = projectFiles[i];
        
        // Skip files we shouldn't analyze
        if (!FileSystemService.isAnalyzableFile(filePath)) {
          continue;
        }
        
        progress?.report({ 
          message: `Processing file ${i + 1}/${projectFiles.length}: ${path.basename(filePath)}` 
        });
        
        const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
        
        // Extract symbols from the file
        const symbols = await SymbolExtractionService.extractSymbols(
          filePath, 
          normalizedPath, 
          rootPath
        );
        
        // Preserve docstrings from existing symbol index if available
        const existingFileSymbols = existingSymbolIndex?.[normalizedPath] || [];
        const mergedSymbols = this.mergeDocstrings(existingFileSymbols, symbols);
        
        // Initialize file entry in the index
        if (mergedSymbols.length > 0) {
          symbolIndex[normalizedPath] = mergedSymbols;
        }
      }
      
      // Complete the indexing with shared post-processing
      return this.finishIndexCreation(symbolIndex, projectFiles, rootPath, progress);
    } catch (error) {
      console.error('Error creating symbol index:', error);
      throw error;
    }
  },

  /**
   * Updates the symbol index for a changed file
   * @param rootPath - Project root path
   * @param existingIndex - Existing symbol index
   * @param changedFilePath - Path to the changed file
   * @param ignoredPatterns - Patterns to ignore
   * @returns Updated symbol index
   */
  async updateSymbolIndex(
    rootPath: string,
    existingIndex: SymbolIndex,
    changedFilePath: string,
    ignoredPatterns: string[] = []
  ): Promise<SymbolIndex> {
    try {
      // Read the on-disk symbol index to preserve any manually added docstrings
      const onDiskSymbolIndex = await SymbolIndexService.readSymbolIndex(rootPath);
      
      // Create a deep copy of the existing index to avoid modifying the original,
      // but prioritize the on-disk index if available to preserve manual edits
      const updatedIndex: SymbolIndex = onDiskSymbolIndex 
        ? JSON.parse(JSON.stringify(onDiskSymbolIndex)) 
        : JSON.parse(JSON.stringify(existingIndex));
      
      // Normalize the changed file path
      const normalizedChangedPath = FileSystemService.normalizeFilePath(changedFilePath, rootPath);
      
      // Skip if not a file we should analyze
      if (!FileSystemService.isAnalyzableFile(changedFilePath)) {
        return updatedIndex;
      }
      
      // Handle file deletion
      const fileExists = await FileSystemService.fileExists(changedFilePath);
      if (!fileExists) {
        return this.handleDeletedFile(updatedIndex, normalizedChangedPath, rootPath);
      }
      
      // Store existing symbols from both the in-memory cache and the on-disk file 
      const existingFileSymbols = updatedIndex[normalizedChangedPath] || [];
      const inMemoryFileSymbols = existingIndex[normalizedChangedPath] || [];
      
      // Combine docstrings from both sources, prioritizing on-disk version
      const combinedExistingSymbols = this.mergeExistingSymbols(
        existingFileSymbols,
        inMemoryFileSymbols
      );
      
      // Remove the changed file from the index
      delete updatedIndex[normalizedChangedPath];
      
      // Remove references to the changed file from the index
      this.pruneSymbolReferences(updatedIndex, normalizedChangedPath);
      
      // Extract new symbols from the changed file
      const newSymbols = await SymbolExtractionService.extractSymbols(
        changedFilePath, 
        normalizedChangedPath, 
        rootPath
      );
      
      // Merge docstrings from existing symbols to new symbols
      const mergedSymbols = this.mergeDocstrings(combinedExistingSymbols, newSymbols);
      
      // Add merged symbols to the index
      if (mergedSymbols.length > 0) {
        updatedIndex[normalizedChangedPath] = mergedSymbols;
      }
      
      // Get all project files to resolve dependencies
      const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
      
      // Complete the indexing with shared post-processing
      return this.finishIndexCreation(updatedIndex, projectFiles, rootPath);
    } catch (error) {
      console.error('Error updating symbol index:', error);
      // If anything goes wrong during the update, return the original index unchanged
      return existingIndex;
    }
  },

  /**
   * Merges symbols from the on-disk and in-memory caches, prioritizing the on-disk version
   * @param onDiskSymbols - Symbols from the on-disk symbol index
   * @param inMemorySymbols - Symbols from the in-memory cache
   * @returns Combined symbols with preserved docstrings
   */
  mergeExistingSymbols(
    onDiskSymbols: SymbolIndexEntry[],
    inMemorySymbols: SymbolIndexEntry[]
  ): SymbolIndexEntry[] {
    // Start with all symbols from in-memory cache
    const result = [...inMemorySymbols];
    
    // For each on-disk symbol, either update or add it to the result
    for (const onDiskSymbol of onDiskSymbols) {
      const existingIndex = result.findIndex(
        s => s.name === onDiskSymbol.name && s.type === onDiskSymbol.type
      );
      
      if (existingIndex >= 0) {
        // Update existing symbol, prioritizing on-disk docstring
        if (onDiskSymbol.docstring && 
            onDiskSymbol.docstring !== '/** */' && 
            onDiskSymbol.docstring !== '') {
          result[existingIndex].docstring = onDiskSymbol.docstring;
        }
      } else {
        // Add on-disk symbol not found in in-memory cache
        result.push(onDiskSymbol);
      }
    }
    
    return result;
  },

  /**
   * Handles when a file is deleted from the project
   * @param updatedIndex - The current index being updated
   * @param normalizedChangedPath - Normalized path of the deleted file
   * @param rootPath - Project root path
   * @returns The updated index
   */
  async handleDeletedFile(
    updatedIndex: SymbolIndex,
    normalizedChangedPath: string,
    rootPath: string
  ): Promise<SymbolIndex> {
    // Remove the file from the index
    delete updatedIndex[normalizedChangedPath];
    
    // Remove references to the deleted file from the index
    this.pruneSymbolReferences(updatedIndex, normalizedChangedPath);
    
    // Write the updated index to file
    await SymbolIndexService.writeSymbolIndex(rootPath, updatedIndex);
    
    return updatedIndex;
  },

  /**
   * Merges docstrings from existing symbols to new symbols
   * @param existingSymbols - Existing symbols from the file
   * @param newSymbols - Newly extracted symbols
   * @returns Merged symbols with preserved docstrings
   */
  mergeDocstrings(
    existingSymbols: SymbolIndexEntry[],
    newSymbols: SymbolIndexEntry[]
  ): SymbolIndexEntry[] {
    return newSymbols.map(newSymbol => {
      // Try to find a matching symbol in the existing file symbols
      const existingSymbol = existingSymbols.find(
        existing => existing.name === newSymbol.name && existing.type === newSymbol.type
      );
      
      // If a match is found and it has a non-empty docstring, preserve it
      if (existingSymbol && existingSymbol.docstring && existingSymbol.docstring !== '/** */' && existingSymbol.docstring !== '') {
        return {
          ...newSymbol,
          docstring: existingSymbol.docstring
        };
      }
      
      return newSymbol;
    });
  },

  /**
   * Removes references to a specific file from the symbol index
   * @param index - The symbol index to update
   * @param filePath - Normalized path of the file to remove references to
   */
  pruneSymbolReferences(
    index: SymbolIndex,
    filePath: string
  ): void {
    for (const indexFilePath in index) {
      if (indexFilePath === filePath) {
        continue;
      }
      
      const fileSymbols = index[indexFilePath];
      
      for (const symbol of fileSymbols) {
        // Remove references to the file in dependents
        symbol.dependents = symbol.dependents.filter(
          dependent => dependent.filePath !== filePath
        );
        
        // Remove dependencies on symbols from the file
        symbol.depends_on = symbol.depends_on.filter(dep => 
          dep.filePath !== filePath
        );
      }
    }
  },

  /**
   * Completes the index creation process with shared post-processing steps
   * @param index - The symbol index to finalize
   * @param projectFiles - List of project files
   * @param rootPath - Project root path
   * @param progress - Optional progress reporter
   * @returns The finalized symbol index
   */
  async finishIndexCreation(
    index: SymbolIndex,
    projectFiles: string[],
    rootPath: string,
    progress?: { report: (info: { message: string }) => void }
  ): Promise<SymbolIndex> {
    // Resolve dependencies between symbols
    progress?.report({ message: 'Resolving symbol dependencies...' });
    await DependencyResolverService.resolveDependencies(index, projectFiles, rootPath);
    
    // Write the symbol index to file
    progress?.report({ message: 'Writing symbol index to file...' });
    await SymbolIndexService.writeSymbolIndex(rootPath, index);
    
    progress?.report({ message: 'Symbol index creation complete.' });
    return index;
  }
}; 