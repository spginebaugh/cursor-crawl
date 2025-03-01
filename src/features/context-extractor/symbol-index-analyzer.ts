import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { FileImportInfo } from '@/shared/types/relevant-info';

/**
 * Interface for the result of analyzing a symbol index
 */
export interface SymbolIndexAnalysisResult {
  /**
   * Filtered symbol index containing only relevant symbols
   */
  filteredIndex: SymbolIndex;
  
  /**
   * Dependency information extracted from the symbol index
   */
  dependencyInfo: Record<string, FileImportInfo>;
  
  /**
   * Set of relevant files that were included in the analysis
   */
  relevantFiles: Set<string>;
}

/**
 * Service for analyzing and transforming symbol indices
 */
export const SymbolIndexAnalyzer = {
  /**
   * Analyzes a symbol index to extract relevant information
   * @param symbolIndex The complete symbol index
   * @param contextFiles Array of file paths to filter by
   * @returns Analysis result containing filtered index and dependency info
   */
  analyzeSymbolIndex(
    symbolIndex: SymbolIndex,
    contextFiles: string[]
  ): SymbolIndexAnalysisResult {
    // Create a set of files we know we want to include
    const relevantFiles = new Set<string>(contextFiles);
    
    // Initialize result structures
    const filteredIndex: SymbolIndex = {};
    const dependencyInfo: Record<string, FileImportInfo> = {};
    
    // First pass: process direct context files and initialize structures
    this.processDirectContextFiles(symbolIndex, contextFiles, filteredIndex, dependencyInfo);
    
    // Second pass: process references and build dependency relationships
    this.processReferencesAndDependencies(symbolIndex, filteredIndex, dependencyInfo, relevantFiles);
    
    // Third pass: consolidate and normalize results
    this.normalizeResults(filteredIndex, dependencyInfo);
    
    return {
      filteredIndex,
      dependencyInfo,
      relevantFiles
    };
  },

  /**
   * Process direct context files - initialize filtered index and dependency info
   */
  processDirectContextFiles(
    symbolIndex: SymbolIndex,
    contextFiles: string[],
    filteredIndex: SymbolIndex,
    dependencyInfo: Record<string, FileImportInfo>
  ): void {
    for (const filePath of contextFiles) {
      // Initialize dependency info for this file
      dependencyInfo[filePath] = {
        imports: [],
        importedBy: []
      };
      
      // Add symbols from this file to the filtered index
      if (symbolIndex[filePath]) {
        filteredIndex[filePath] = symbolIndex[filePath].map(symbol => ({
          ...symbol,
          dependents: [],
          depends_on: []
        }));
      }
    }
  },

  /**
   * Process references and build dependency relationships
   */
  processReferencesAndDependencies(
    symbolIndex: SymbolIndex,
    filteredIndex: SymbolIndex,
    dependencyInfo: Record<string, FileImportInfo>,
    relevantFiles: Set<string>
  ): void {
    // Process each context file to find dependencies and dependents
    for (const filePath in filteredIndex) {
      const fileSymbols = filteredIndex[filePath];
      
      if (!fileSymbols) {continue;}
      
      for (const symbol of fileSymbols) {
        // Process dependencies (files this file imports from)
        this.processDependencies(symbol, filePath, symbolIndex, filteredIndex, dependencyInfo, relevantFiles);
        
        // Process dependents (files that import from this file)
        this.processDependents(symbol, filePath, symbolIndex, filteredIndex, dependencyInfo, relevantFiles);
      }
    }
  },

  /**
   * Process dependencies for a symbol (files it depends on)
   */
  processDependencies(
    symbol: SymbolIndexEntry,
    filePath: string,
    symbolIndex: SymbolIndex,
    filteredIndex: SymbolIndex,
    dependencyInfo: Record<string, FileImportInfo>,
    relevantFiles: Set<string>
  ): void {
    for (const dependency of symbol.depends_on || []) {
      const sourceFile = dependency.filePath;
      if (!sourceFile || sourceFile === filePath) {continue;}
      
      // Add to the set of relevant files
      relevantFiles.add(sourceFile);
      
      // Add to dependency info
      this.addImportRelationship(
        dependencyInfo,
        filePath,
        sourceFile,
        dependency.name
      );
      
      // Make sure the source file is in the filtered index
      if (!filteredIndex[sourceFile] && symbolIndex[sourceFile]) {
        filteredIndex[sourceFile] = symbolIndex[sourceFile].map(s => ({
          ...s,
          dependents: [],
          depends_on: []
        }));
      }
    }
  },

  /**
   * Process dependents for a symbol (files that depend on it)
   */
  processDependents(
    symbol: SymbolIndexEntry,
    filePath: string,
    symbolIndex: SymbolIndex,
    filteredIndex: SymbolIndex,
    dependencyInfo: Record<string, FileImportInfo>,
    relevantFiles: Set<string>
  ): void {
    for (const dependent of symbol.dependents || []) {
      const targetFile = dependent.filePath;
      if (!targetFile || targetFile === filePath) {continue;}
      
      // Add to the set of relevant files
      relevantFiles.add(targetFile);
      
      // Add to dependency info
      this.addImportedByRelationship(
        dependencyInfo,
        filePath,
        targetFile,
        dependent.name
      );
      
      // Make sure the target file is in the filtered index
      if (!filteredIndex[targetFile] && symbolIndex[targetFile]) {
        filteredIndex[targetFile] = symbolIndex[targetFile].map(s => ({
          ...s,
          dependents: [],
          depends_on: []
        }));
      }
    }
  },

  /**
   * Add an import relationship to the dependency info
   */
  addImportRelationship(
    dependencyInfo: Record<string, FileImportInfo>,
    sourceFile: string,
    targetFile: string,
    symbolName: string
  ): void {
    // Initialize if it doesn't exist
    if (!dependencyInfo[sourceFile]) {
      dependencyInfo[sourceFile] = {
        imports: [],
        importedBy: []
      };
    }
    
    // Find existing import or create new one
    let existingImport = dependencyInfo[sourceFile].imports.find(
      imp => imp.from === targetFile
    );
    
    if (!existingImport) {
      existingImport = { from: targetFile, imports: [] };
      dependencyInfo[sourceFile].imports.push(existingImport);
    }
    
    // Add the symbol to the imports if it's not already there
    if (!existingImport.imports.includes(symbolName)) {
      existingImport.imports.push(symbolName);
    }
  },

  /**
   * Add an imported-by relationship to the dependency info
   */
  addImportedByRelationship(
    dependencyInfo: Record<string, FileImportInfo>,
    targetFile: string,
    sourceFile: string,
    symbolName: string
  ): void {
    // Initialize if it doesn't exist
    if (!dependencyInfo[targetFile]) {
      dependencyInfo[targetFile] = {
        imports: [],
        importedBy: []
      };
    }
    
    // Find existing importedBy or create new one
    let existingImportedBy = dependencyInfo[targetFile].importedBy.find(
      imp => imp.from === sourceFile
    );
    
    if (!existingImportedBy) {
      existingImportedBy = { from: sourceFile, imports: [] };
      dependencyInfo[targetFile].importedBy.push(existingImportedBy);
    }
    
    // Add the symbol to the importedBy if it's not already there
    if (!existingImportedBy.imports.includes(symbolName)) {
      existingImportedBy.imports.push(symbolName);
    }
  },

  /**
   * Normalize and finalize the results
   */
  normalizeResults(
    filteredIndex: SymbolIndex,
    dependencyInfo: Record<string, FileImportInfo>
  ): void {
    // Ensure all files in filteredIndex have entries in dependencyInfo
    for (const filePath in filteredIndex) {
      if (!dependencyInfo[filePath]) {
        dependencyInfo[filePath] = {
          imports: [],
          importedBy: []
        };
      }
    }
    
    // Ensure all files in dependencyInfo have entries in filteredIndex (if they exist in original index)
    for (const filePath in dependencyInfo) {
      if (!filteredIndex[filePath]) {
        filteredIndex[filePath] = [];
      }
    }
  }
}; 