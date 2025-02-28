import * as fs from 'fs-extra';
import * as path from 'path';
import { DependencyMap } from './types/dependency-map';
import { SmartSymbolIndex } from './types/smart-symbol-index';
import { RelevantInfo } from './types/relevant-info';

/**
 * Extracts context file references from a prompt string
 * @param promptText The prompt text to analyze
 * @returns Array of file paths referenced in the prompt
 */
export const extractContextFiles = (promptText: string): string[] => {
  // Match patterns like @filename.ts or @path/to/file.ts
  const regex = /@([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g;
  const matches = promptText.match(regex) || [];
  
  // Remove the @ prefix and normalize paths
  return matches.map(match => match.substring(1).replace(/\\/g, '/'));
};

/**
 * Filters the dependency map to only include entries relevant to the context files
 * @param dependencyMap The full dependency map
 * @param contextFiles Array of file paths to filter by
 * @returns Filtered dependency map
 */
export const filterDependencyMap = (
  dependencyMap: DependencyMap,
  contextFiles: string[]
): DependencyMap => {
  const relevantFiles = new Set<string>(contextFiles);
  const result: DependencyMap = { files: {} };
  
  // First, include the direct context files
  for (const file of contextFiles) {
    if (dependencyMap.files[file]) {
      result.files[file] = {
        imports: [],
        importedBy: []
      };
    }
  }
  
  // Then add their direct imports and importedBy relationships
  for (const contextFile of contextFiles) {
    const fileInfo = dependencyMap.files[contextFile];
    if (!fileInfo) {continue;}
    
    // Add direct imports
    for (const importInfo of fileInfo.imports) {
      relevantFiles.add(importInfo.from);
      
      // Initialize the import target if it doesn't exist yet
      if (!result.files[importInfo.from]) {
        result.files[importInfo.from] = {
          imports: [],
          importedBy: []
        };
      }
      
      // Add the import relationship
      result.files[contextFile].imports.push(importInfo);
    }
    
    // Add files that import this file
    for (const importedByInfo of fileInfo.importedBy) {
      relevantFiles.add(importedByInfo.from);
      
      // Initialize the importing file if it doesn't exist yet
      if (!result.files[importedByInfo.from]) {
        result.files[importedByInfo.from] = {
          imports: [],
          importedBy: []
        };
      }
      
      // Add the importedBy relationship
      result.files[contextFile].importedBy.push(importedByInfo);
    }
  }
  
  // Update the individual file entries to include only relevant relationships
  for (const file of relevantFiles) {
    if (!result.files[file]) {continue;}
    
    // Filter imports to only include relevant files
    result.files[file].imports = result.files[file].imports.filter(
      importInfo => relevantFiles.has(importInfo.from)
    );
    
    // Filter importedBy to only include relevant files
    result.files[file].importedBy = result.files[file].importedBy.filter(
      importedByInfo => relevantFiles.has(importedByInfo.from)
    );
  }
  
  return result;
};

/**
 * Filters the symbol index to only include entries relevant to the context files
 * @param symbolIndex The full symbol index
 * @param contextFiles Array of file paths to filter by
 * @returns Filtered symbol index
 */
export const filterSymbolIndex = (
  symbolIndex: SmartSymbolIndex,
  contextFiles: string[]
): SmartSymbolIndex => {
  const relevantFiles = new Set<string>(contextFiles);
  const result: SmartSymbolIndex = { symbols: {} };
  
  // First pass: include symbols defined in context files
  for (const symbolId in symbolIndex.symbols) {
    const symbol = symbolIndex.symbols[symbolId];
    
    if (contextFiles.includes(symbol.file)) {
      result.symbols[symbolId] = {
        ...symbol,
        references: {},
        calls: []
      };
    }
  }
  
  // Second pass: include symbols that are referenced by symbols in context files
  for (const symbolId in symbolIndex.symbols) {
    const symbol = symbolIndex.symbols[symbolId];
    
    // Track symbols called by symbols in context files
    if (contextFiles.includes(symbol.file)) {
      result.symbols[symbolId].calls = symbol.calls.filter(call => {
        // Find the symbol by name
        const calledSymbolId = Object.keys(symbolIndex.symbols).find(id => 
          symbolIndex.symbols[id].name === call.symbolName
        );
        
        if (calledSymbolId) {
          const calledSymbol = symbolIndex.symbols[calledSymbolId];
          
          // Add this file to our relevant files if it's not already there
          relevantFiles.add(calledSymbol.file);
          
          // Add the called symbol to our result if it's not already there
          if (!result.symbols[calledSymbolId]) {
            result.symbols[calledSymbolId] = {
              ...calledSymbol,
              references: {},
              calls: []
            };
          }
          
          return true;
        }
        
        return false;
      });
    }
  }
  
  // Third pass: include references to symbols defined in context files
  for (const symbolId in result.symbols) {
    const originalSymbol = symbolIndex.symbols[symbolId];
    
    // Filter references to only include those from relevant files
    for (const referencingFile in originalSymbol.references) {
      if (relevantFiles.has(referencingFile)) {
        result.symbols[symbolId].references[referencingFile] = originalSymbol.references[referencingFile];
      }
    }
  }
  
  return result;
};

/**
 * Generates relevant information based on context files
 * @param rootPath The root path of the project
 * @param contextFiles Array of file paths that are referenced in the prompt
 * @returns The filtered relevant information
 */
export const generateRelevantInfo = async (
  rootPath: string,
  contextFiles: string[]
): Promise<RelevantInfo> => {
  try {
    // Normalize context file paths
    const normalizedContextFiles = contextFiles.map(file => file.replace(/\\/g, '/'));
    
    // Read in the dependency map and symbol index
    const dependencyMapPath = path.join(rootPath, '.cursortest', 'dependency-map.json');
    const symbolIndexPath = path.join(rootPath, '.cursortest', 'smart-symbol-index.json');
    
    if (!await fs.pathExists(dependencyMapPath) || !await fs.pathExists(symbolIndexPath)) {
      throw new Error('Dependency map or symbol index not found. Please run cursorcrawl.analyze first.');
    }
    
    const dependencyMap: DependencyMap = await fs.readJson(dependencyMapPath);
    const symbolIndex: SmartSymbolIndex = await fs.readJson(symbolIndexPath);
    
    // Filter the maps to only include relevant information
    const filteredDependencyMap = filterDependencyMap(dependencyMap, normalizedContextFiles);
    const filteredSymbolIndex = filterSymbolIndex(symbolIndex, normalizedContextFiles);
    
    // Create the relevant info object
    const relevantInfo: RelevantInfo = {
      dependencies: filteredDependencyMap,
      symbols: filteredSymbolIndex,
      contextFiles: normalizedContextFiles
    };
    
    // Write the filtered information to file
    const outputPath = path.join(rootPath, '.cursortest', 'relevant-info.json');
    await fs.writeJson(outputPath, relevantInfo, { spaces: 2 });
    
    return relevantInfo;
  } catch (error) {
    console.error('Error generating relevant information:', error);
    throw error;
  }
}; 