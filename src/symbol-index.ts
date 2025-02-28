import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';

// Import types and utilities
import {
  SymbolIndexEntry,
  DependentInfo,
  DependencyInfo,
  SymbolIndex
} from './types/symbol-index';
import {
  ANALYZABLE_EXTENSIONS,
  ALWAYS_IGNORED_DIRS,
  MAX_FILES_TO_PROCESS,
  isAnalyzableFile,
  normalizeFilePath,
  getProjectFiles,
  isIgnored
} from './utils/file-system';
import {
  computeLineStarts,
  getLineNumber,
  extractCodeSnippet,
  getContextSnippet,
  getLineAndCharacter
} from './utils/ts-analyzer';
import {
  writeCursorTestFile,
  ensureCursorTestDir
} from './utils/workspace';

// Output directory and file for the symbol index
const OUTPUT_DIR = '.cursortest';
const OUTPUT_FILE = 'symbol-index.json';

/**
 * Creates a complete symbol index for a project
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 * @returns The complete symbol index
 */
export const createSymbolIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: { report: (info: { message: string }) => void }
): Promise<SymbolIndex> => {
  try {
    progress?.report({ message: 'Analyzing project structure...' });
    
    // Get all project files
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Safety check - limit number of files to process
    if (projectFiles.length > MAX_FILES_TO_PROCESS) {
      console.warn(`Project contains ${projectFiles.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
      projectFiles.length = MAX_FILES_TO_PROCESS;
    }
    
    // Initialize the symbol index with file-based organization
    const symbolIndex: SymbolIndex = {};
    
    // First pass: Extract all symbols and their basic information
    progress?.report({ message: 'Extracting symbols from files...' });
    for (let i = 0; i < projectFiles.length; i++) {
      const filePath = projectFiles[i];
      
      // Skip files we shouldn't analyze
      if (!isAnalyzableFile(filePath)) {
        continue;
      }
      
      progress?.report({ 
        message: `Processing file ${i + 1}/${projectFiles.length}: ${path.basename(filePath)}` 
      });
      
      const normalizedPath = normalizeFilePath(filePath, rootPath);
      
      // Extract symbols from the file
      const symbols = await extractSymbols(filePath, normalizedPath, rootPath);
      
      // Initialize file entry in the index
      if (symbols.length > 0) {
        symbolIndex[normalizedPath] = symbols;
      }
    }
    
    // Second pass: Resolve dependencies between symbols
    progress?.report({ message: 'Resolving symbol dependencies...' });
    await resolveDependencies(symbolIndex, projectFiles, rootPath);
    
    // Write the symbol index to file
    progress?.report({ message: 'Writing symbol index to file...' });
    await writeSymbolIndex(rootPath, symbolIndex);
    
    progress?.report({ message: 'Symbol index creation complete.' });
    return symbolIndex;
  } catch (error) {
    console.error('Error creating symbol index:', error);
    throw error;
  }
};

/**
 * Extracts symbols from a file
 * @param filePath - Path to the file
 * @param normalizedPath - Normalized file path relative to project root
 * @param rootPath - Project root path
 * @returns Array of symbol entries
 */
const extractSymbols = async (
  filePath: string,
  normalizedPath: string,
  rootPath: string
): Promise<SymbolIndexEntry[]> => {
  try {
    // Skip non-analyzable files
    if (!isAnalyzableFile(filePath)) {
      return [];
    }
    
    // Read the file content
    const fileContent = await fs.readFile(filePath, 'utf8');
    
    // Skip files that are too large
    if (fileContent.length > 1000000) { // 1MB limit
      console.log(`Skipping large file: ${filePath} (${Math.round(fileContent.length/1024)}KB)`);
      return [];
    }
    
    // Create a TypeScript source file
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );
    
    const symbols: SymbolIndexEntry[] = [];
    
    // Recursively visit nodes to extract symbols
    const visit = (node: ts.Node) => {
      try {
        // Skip nodes that already have documentation comments
        const hasJSDoc = ts.getJSDocTags(node).length > 0;
        
        // Extract function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = getLineAndCharacter(sourceFile, node);
          const snippet = extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'function',
            filePath: normalizedPath,
            location,
            docstring: hasJSDoc ? '' : '/** */', // Placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract class declarations
        else if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = getLineAndCharacter(sourceFile, node);
          const snippet = extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'class',
            filePath: normalizedPath,
            location,
            docstring: hasJSDoc ? '' : '/** */', // Placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
          
          // Process class methods
          node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
              const methodName = member.name.getText(sourceFile);
              const methodHasJSDoc = ts.getJSDocTags(member).length > 0;
              const location = getLineAndCharacter(sourceFile, member);
              const snippet = extractCodeSnippet(sourceFile, member);
              
              symbols.push({
                name: `${name}.${methodName}`,
                type: 'method',
                filePath: normalizedPath,
                location,
                docstring: methodHasJSDoc ? '' : '/** */', // Placeholder
                snippet,
                dependents: [],
                depends_on: []
              });
            }
          });
        }
        
        // Extract interface declarations
        else if (ts.isInterfaceDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = getLineAndCharacter(sourceFile, node);
          const snippet = extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'interface',
            filePath: normalizedPath,
            location,
            docstring: hasJSDoc ? '' : '/** */', // Placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract type aliases
        else if (ts.isTypeAliasDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = getLineAndCharacter(sourceFile, node);
          const snippet = extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'type',
            filePath: normalizedPath,
            location,
            docstring: hasJSDoc ? '' : '/** */', // Placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract enum declarations
        else if (ts.isEnumDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = getLineAndCharacter(sourceFile, node);
          const snippet = extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'enum',
            filePath: normalizedPath,
            location,
            docstring: hasJSDoc ? '' : '/** */', // Placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract variable declarations
        else if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(declaration => {
            if (ts.isIdentifier(declaration.name)) {
              const name = declaration.name.text;
              const varHasJSDoc = ts.getJSDocTags(declaration).length > 0;
              const location = getLineAndCharacter(sourceFile, declaration);
              const snippet = extractCodeSnippet(sourceFile, declaration);
              
              symbols.push({
                name,
                type: 'variable',
                filePath: normalizedPath,
                location,
                docstring: varHasJSDoc ? '' : '/** */', // Placeholder
                snippet,
                dependents: [],
                depends_on: []
              });
            }
          });
        }
        
        // Process child nodes
        ts.forEachChild(node, visit);
      } catch (error) {
        console.error(`Error processing node in ${filePath}:`, error);
      }
    };
    
    // Start the traversal
    visit(sourceFile);
    
    return symbols;
  } catch (error) {
    console.error(`Error extracting symbols from ${filePath}:`, error);
    return [];
  }
};

/**
 * Resolves dependencies between symbols
 * @param symbolIndex - The symbol index
 * @param projectFiles - List of project files
 * @param rootPath - Project root path
 */
const resolveDependencies = async (
  symbolIndex: SymbolIndex,
  projectFiles: string[],
  rootPath: string
): Promise<void> => {
  try {
    // Create a flat map of all symbols for easy lookup
    const flatSymbolMap: Record<string, SymbolIndexEntry> = {};
    
    // Build the symbol map
    for (const filePath in symbolIndex) {
      for (const symbol of symbolIndex[filePath]) {
        flatSymbolMap[`${filePath}:${symbol.name}`] = symbol;
      }
    }
    
    // Process each file to find dependencies
    for (const filePath of projectFiles) {
      if (!isAnalyzableFile(filePath)) {
        continue;
      }
      
      const normalizedPath = normalizeFilePath(filePath, rootPath);
      
      // Skip if the file isn't in our index
      if (!symbolIndex[normalizedPath]) {
        continue;
      }
      
      // Read the file content
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      // Skip files that are too large
      if (fileContent.length > 1000000) { // 1MB limit
        continue;
      }
      
      // Create a TypeScript source file
      const sourceFile = ts.createSourceFile(
        filePath,
        fileContent,
        ts.ScriptTarget.Latest,
        true
      );
      
      // Track current enclosing symbol
      let currentSymbol: SymbolIndexEntry | null = null;
      
      // Recursively visit nodes
      const visit = (node: ts.Node) => {
        try {
          // Track the current symbol for function-like declarations
          if (ts.isFunctionDeclaration(node) && node.name) {
            const functionName = node.name.text;
            const symbols = symbolIndex[normalizedPath] || [];
            currentSymbol = symbols.find(s => s.name === functionName) || null;
          }
          else if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent) && node.parent.name) {
            const className = node.parent.name.text;
            const methodName = ts.isIdentifier(node.name) ? node.name.text : '';
            
            if (methodName) {
              const fullName = `${className}.${methodName}`;
              const symbols = symbolIndex[normalizedPath] || [];
              currentSymbol = symbols.find(s => s.name === fullName) || null;
            }
          }
          
          // Process identifiers for references and calls
          if (ts.isIdentifier(node) && node.parent) {
            const identifierName = node.text;
            
            // Skip common identifiers, keywords, etc.
            if (['console', 'require', 'import', 'export', 'this', 'true', 'false', 'null', 'undefined'].includes(identifierName)) {
              return;
            }
            
            // Find all potential target symbols
            const targetSymbols: SymbolIndexEntry[] = [];
            
            for (const filePath in symbolIndex) {
              const fileSymbols = symbolIndex[filePath];
              for (const symbol of fileSymbols) {
                if (symbol.name === identifierName) {
                  targetSymbols.push(symbol);
                }
              }
            }
            
            if (targetSymbols.length === 0) {
              return;
            }
            
            // Handle function/method calls
            if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
              const position = node.getStart(sourceFile);
              const lineNumber = getLineNumber(sourceFile, position);
              const contextSnippet = getContextSnippet(sourceFile, position, 3);
              
              for (const targetSymbol of targetSymbols) {
                // Skip self-references
                if (currentSymbol === targetSymbol) {
                  continue;
                }
                
                // Add dependency relationship if current symbol is defined
                if (currentSymbol) {
                  // Add to current symbol's depends_on list
                  currentSymbol.depends_on.push({
                    name: targetSymbol.name,
                    filePath: targetSymbol.filePath,
                    line: lineNumber
                  });
                  
                  // Add to target symbol's dependents list
                  targetSymbol.dependents.push({
                    name: currentSymbol.name,
                    filePath: currentSymbol.filePath,
                    line: lineNumber,
                    contextSnippet
                  });
                }
              }
            }
          }
          
          // Continue with child nodes
          const prevSymbol = currentSymbol;
          ts.forEachChild(node, visit);
          currentSymbol = prevSymbol;
        } catch (error) {
          console.error(`Error processing node in ${filePath}:`, error);
        }
      };
      
      // Start the traversal
      visit(sourceFile);
    }
  } catch (error) {
    console.error(`Error resolving dependencies:`, error);
  }
};

/**
 * Writes the symbol index to a file
 * @param rootPath - Project root path
 * @param symbolIndex - Symbol index to write
 */
const writeSymbolIndex = async (
  rootPath: string,
  symbolIndex: SymbolIndex
): Promise<void> => {
  try {
    // Create the output directory if it doesn't exist
    await ensureCursorTestDir(rootPath);
    
    // Write the index to file
    await writeCursorTestFile(rootPath, OUTPUT_FILE, symbolIndex);
    
    console.log(`Symbol index written to ${path.join(rootPath, OUTPUT_DIR, OUTPUT_FILE)}`);
  } catch (error) {
    console.error('Error writing symbol index:', error);
    throw error;
  }
};

/**
 * Updates the symbol index for a changed file
 * @param rootPath - Project root path
 * @param existingIndex - Existing symbol index
 * @param changedFilePath - Path to the changed file
 * @param ignoredPatterns - Patterns to ignore
 * @returns Updated symbol index
 */
export const updateSymbolIndex = async (
  rootPath: string,
  existingIndex: SymbolIndex,
  changedFilePath: string,
  ignoredPatterns: string[] = []
): Promise<SymbolIndex> => {
  try {
    // Create a deep copy of the existing index to avoid modifying the original
    const updatedIndex: SymbolIndex = JSON.parse(JSON.stringify(existingIndex));
    
    // Normalize the changed file path
    const normalizedChangedPath = normalizeFilePath(changedFilePath, rootPath);
    
    // Skip if not a file we should analyze
    if (!isAnalyzableFile(changedFilePath)) {
      return updatedIndex;
    }
    
    // If the file was deleted
    if (!await fs.pathExists(changedFilePath)) {
      // Get all symbols from the deleted file
      const deletedSymbols = updatedIndex[normalizedChangedPath] || [];
      
      // Remove the file from the index
      delete updatedIndex[normalizedChangedPath];
      
      // Remove dependencies involving deleted symbols
      for (const filePath in updatedIndex) {
        const fileSymbols = updatedIndex[filePath];
        
        for (const symbol of fileSymbols) {
          // Remove references to deleted file in dependents
          symbol.dependents = symbol.dependents.filter(
            dependent => dependent.filePath !== normalizedChangedPath
          );
          
          // Remove dependencies on deleted symbols
          symbol.depends_on = symbol.depends_on.filter(dep => 
            !deletedSymbols.some(s => s.name === dep.name)
          );
        }
      }
      
      // Write the updated index to file
      await writeSymbolIndex(rootPath, updatedIndex);
      
      return updatedIndex;
    }
    
    // Remove all symbols from the changed file
    delete updatedIndex[normalizedChangedPath];
    
    // Extract new symbols from the changed file
    const newSymbols = await extractSymbols(changedFilePath, normalizedChangedPath, rootPath);
    
    // Add new symbols to the index
    if (newSymbols.length > 0) {
      updatedIndex[normalizedChangedPath] = newSymbols;
    }
    
    // Remove dependencies involving the changed file
    for (const filePath in updatedIndex) {
      if (filePath === normalizedChangedPath) {
        continue;
      }
      
      const fileSymbols = updatedIndex[filePath];
      
      for (const symbol of fileSymbols) {
        // Remove references to changed file in dependents
        symbol.dependents = symbol.dependents.filter(
          dependent => dependent.filePath !== normalizedChangedPath
        );
        
        // Keep dependencies on symbols in other files
        symbol.depends_on = symbol.depends_on.filter(dep => 
          !newSymbols.some(s => s.name === dep.name)
        );
      }
    }
    
    // Resolve dependencies for the changed file
    const projectFiles = [changedFilePath];
    for (const filePath in updatedIndex) {
      const fullPath = path.join(rootPath, filePath);
      if (await fs.pathExists(fullPath) && fullPath !== changedFilePath) {
        projectFiles.push(fullPath);
      }
    }
    
    await resolveDependencies(updatedIndex, projectFiles, rootPath);
    
    // Write the updated index to file
    await writeSymbolIndex(rootPath, updatedIndex);
    
    return updatedIndex;
  } catch (error) {
    console.error('Error updating symbol index:', error);
    // If anything goes wrong during the update, return the original index unchanged
    return existingIndex;
  }
}; 