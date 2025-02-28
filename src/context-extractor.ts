import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import { FileDependencyInfo, DependencyMap } from './types/dependency-map';
import { SymbolIndexEntry, SymbolIndex } from './types/symbol-index';
import { RelevantInfo } from './types/relevant-info';
import { 
  isAnalyzableFile, 
  normalizeFilePath, 
  getProjectFiles,
  execAsync
} from './utils/file-system';
import { 
  getLineNumber,
  extractCodeSnippet,
  getContextSnippet
} from './utils/ts-analyzer';
import { getWorkspaceFolder } from './utils/workspace';

/**
 * Extracts context file references from a prompt string
 * @param promptText The prompt text to analyze
 * @returns Array of file paths referenced in the prompt
 */
export const extractContextFiles = (prompt: string): string[] => {
  // Match @filename.ext patterns in the prompt
  const fileMatches = prompt.match(/@[\w.\/-]+/g);
  
  if (!fileMatches) {
    return [];
  }
  
  // Remove @ prefix and deduplicate
  return [...new Set(fileMatches.map(match => match.substring(1).trim()))];
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
  symbolIndex: SymbolIndex,
  contextFiles: string[]
): SymbolIndex => {
  const relevantFiles = new Set<string>(contextFiles);
  const result: SymbolIndex = {};
  
  // First pass: include symbols defined in context files
  for (const filePath in symbolIndex) {
    if (contextFiles.includes(filePath)) {
      result[filePath] = symbolIndex[filePath].map(symbol => ({
        ...symbol,
        dependents: [],
        depends_on: []
      }));
    }
  }
  
  // Second pass: include symbols that are referenced by symbols in context files
  for (const filePath in symbolIndex) {
    if (contextFiles.includes(filePath)) {
      for (const symbol of symbolIndex[filePath]) {
        const resultSymbol = result[filePath].find(s => s.name === symbol.name);
        if (resultSymbol) {
          // Collect symbols that this symbol depends on
          for (const dependency of symbol.depends_on) {
            // Find the file path containing the referenced symbol
            for (const otherFilePath in symbolIndex) {
              const referencedSymbol = symbolIndex[otherFilePath].find(
                s => s.name === dependency.name
              );
              
              if (referencedSymbol) {
                // Add this file to our relevant files
                relevantFiles.add(otherFilePath);
                
                // Add the file to our result if it's not already there
                if (!result[otherFilePath]) {
                  result[otherFilePath] = [];
                }
                
                // Add the referenced symbol to our result if it's not already there
                if (!result[otherFilePath].find(s => s.name === referencedSymbol.name)) {
                  result[otherFilePath].push({
                    ...referencedSymbol,
                    dependents: [],
                    depends_on: []
                  });
                }
                
                // Add the dependency to our symbol
                resultSymbol.depends_on.push(dependency);
                break;
              }
            }
          }
        }
      }
    }
  }
  
  // Third pass: include references to symbols defined in context files
  for (const filePath in result) {
    for (const symbol of result[filePath]) {
      // Find the original symbol
      const originalFilePath = Object.keys(symbolIndex).find(path => 
        symbolIndex[path].some(s => s.name === symbol.name)
      );
      
      if (originalFilePath) {
        const originalSymbol = symbolIndex[originalFilePath].find(s => s.name === symbol.name);
        if (originalSymbol) {
          // Process dependents
          symbol.dependents = originalSymbol.dependents.filter(dependent => 
            relevantFiles.has(dependent.filePath)
          );
        }
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
  filePatterns: string[],
): Promise<void> => {
  const cursorTestDir = path.join(rootPath, '.cursortest');
  
  // Load dependency map
  const dependencyMapPath = path.join(cursorTestDir, 'dependency-map.json');
  let dependencyMap: DependencyMap = { files: {} };
  
  try {
    const dependencyMapContent = await fs.readFile(dependencyMapPath, 'utf8');
    dependencyMap = JSON.parse(dependencyMapContent);
  } catch (error) {
    console.error('Error loading dependency map:', error);
  }
  
  // Load symbol index
  const symbolIndexPath = path.join(cursorTestDir, 'symbol-index.json');
  let symbolIndex: SymbolIndex = {};
  
  try {
    const symbolIndexContent = await fs.readFile(symbolIndexPath, 'utf8');
    symbolIndex = JSON.parse(symbolIndexContent);
  } catch (error) {
    console.error('Error loading symbol index:', error);
  }
  
  // Find all matching files
  const allMatchingFiles: string[] = [];
  
  for (const pattern of filePatterns) {
    const matchingFiles = await findFilesMatchingPattern(rootPath, pattern);
    allMatchingFiles.push(...matchingFiles);
  }
  
  // Remove duplicates
  const uniqueFiles = [...new Set(allMatchingFiles)];
  
  // Extract relevant information for each file
  const relevantInfo: RelevantInfo = {
    dependencies: { files: {} },
    symbols: { symbols: {} },
    contextFiles: uniqueFiles
  };
  
  for (const filePath of uniqueFiles) {
    if (!isAnalyzableFile(filePath)) {
      continue;
    }
    
    // Extract symbols for this file
    const fileSymbols = await extractRelevantSymbols(rootPath, filePath, symbolIndex);
    
    // Add symbols to the relevant info
    fileSymbols.forEach(symbol => {
      const symbolId = `${symbol.filePath}:${symbol.name}`;
      relevantInfo.symbols.symbols[symbolId] = symbol;
    });
    
    // Extract dependencies for this file
    const { imports, dependencies } = extractDependencies(filePath, rootPath, dependencyMap);
    
    // Add dependency info to the relevant info
    relevantInfo.dependencies.files[filePath] = {
      imports: imports.map(importPath => ({ from: importPath, imports: [] })),
      importedBy: dependencies.map(depPath => ({ from: depPath, imports: [] }))
    };
  }
  
  // Write relevant info to file
  const relevantInfoPath = path.join(cursorTestDir, 'relevant-info.json');
  await fs.writeFile(relevantInfoPath, JSON.stringify(relevantInfo, null, 2), 'utf8');
};

// Function to find all files matching a pattern (using glob matching)
const findFilesMatchingPattern = async (rootPath: string, pattern: string): Promise<string[]> => {
  // Handle exact file paths
  if (pattern.includes('.') && !pattern.includes('*')) {
    // Try with exact path
    const exactPath = path.join(rootPath, pattern);
    if (await fs.pathExists(exactPath)) {
      return [pattern];
    }
    
    // Try searching for the file name in the project
    const fileName = path.basename(pattern);
    const extension = path.extname(fileName);
    const files = await getProjectFiles(rootPath);
    
    return files
      .filter(file => path.basename(file) === fileName)
      .map(file => path.relative(rootPath, file));
  }
  
  // Handle wildcard patterns
  const extension = pattern.includes('.') ? path.extname(pattern) : '.ts';
  const files = await getProjectFiles(rootPath);
  const filteredFiles = files.filter(file => path.extname(file) === extension);
  
  // Convert glob pattern to regex
  const regexPattern = new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*'));
  
  return filteredFiles
    .filter(file => regexPattern.test(file))
    .map(file => path.relative(rootPath, file));
};

// Function to extract relevant symbols from a file
const extractRelevantSymbols = async (
  rootPath: string,
  filePath: string,
  symbolIndex: SymbolIndex,
): Promise<SymbolIndexEntry[]> => {
  const normalizedPath = normalizeFilePath(filePath, rootPath);
  
  // Get symbols for the specified file
  const fileSymbols = symbolIndex[normalizedPath] || [];
  
  return fileSymbols;
};

// Function to extract dependencies and imports for a file
const extractDependencies = (
  filePath: string,
  rootPath: string,
  dependencyMap: DependencyMap,
): { imports: string[]; dependencies: string[] } => {
  const normalizedPath = normalizeFilePath(filePath, rootPath);
  
  // Get file info from dependency map
  const fileInfo = dependencyMap.files[normalizedPath];
  
  if (!fileInfo) {
    return { imports: [], dependencies: [] };
  }
  
  // Extract imports from ImportInfo objects
  const imports = fileInfo.imports.map(importInfo => importInfo.from);
  
  // Extract files that import this file (dependencies)
  const dependencies = fileInfo.importedBy.map(importInfo => importInfo.from);
  
  return { imports, dependencies };
};

// Function to extract source code with additional context from a file
const extractSourceWithContext = async (
  rootPath: string,
  filePath: string,
): Promise<string> => {
  const fullPath = path.join(rootPath, filePath);
  
  try {
    if (await fs.pathExists(fullPath)) {
      const source = await fs.readFile(fullPath, 'utf8');
      return source;
    }
    return '';
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return '';
  }
};