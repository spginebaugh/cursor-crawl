import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import { 
  SmartSymbolIndex, 
  SymbolInfo, 
  ParameterInfo, 
  ReturnTypeInfo,
  CallerInfo,
  CallInfo
} from './types/smart-symbol-index';
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
  getContextSnippet
} from './utils/ts-analyzer';
import {
  writeCursorTestFile,
  ensureCursorTestDir
} from './utils/workspace';

// Output directory and file for the smart symbol index
const OUTPUT_DIR = '.cursortest';
const OUTPUT_FILE = 'smart-symbol-index.json';

/**
 * Creates a complete smart symbol index for a project
 */
export const createSmartSymbolIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = []
): Promise<SmartSymbolIndex> => {
  try {
    // Get all project files (using the same logic as dependency-mapper)
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Safety check - limit number of files to process
    if (projectFiles.length > MAX_FILES_TO_PROCESS) {
      console.warn(`Project contains ${projectFiles.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
      projectFiles.length = MAX_FILES_TO_PROCESS;
    }
    
    // Initialize the symbol index
    const symbolIndex: SmartSymbolIndex = { symbols: {} };
    
    // Map to track symbols by file (for reference resolution)
    const fileSymbolMap: Record<string, string[]> = {};
    
    // First pass: Extract all symbols and their basic information
    for (const filePath of projectFiles) {
      // Skip files we shouldn't analyze
      if (!isAnalyzableFile(filePath)) {
        continue;
      }
      
      const normalizedPath = normalizeFilePath(filePath, rootPath);
      
      // Extract symbols from the file
      const symbols = await extractSymbols(filePath, normalizedPath);
      
      // Add symbols to the index
      for (const symbol of symbols) {
        const symbolId = `${symbol.file}:${symbol.name}`;
        symbolIndex.symbols[symbolId] = {
          ...symbol,
          references: {},
          calls: []
        };
        
        // Track symbols by file for reference resolution
        if (!fileSymbolMap[symbol.file]) {
          fileSymbolMap[symbol.file] = [];
        }
        fileSymbolMap[symbol.file].push(symbolId);
      }
    }
    
    // Second pass: Resolve references and calls
    for (const filePath of projectFiles) {
      if (!isAnalyzableFile(filePath)) {
        continue;
      }
      
      const normalizedPath = normalizeFilePath(filePath, rootPath);
      
      // Extract references and calls
      await resolveReferencesAndCalls(
        filePath, 
        normalizedPath, 
        symbolIndex, 
        fileSymbolMap
      );
    }
    
    // Write the smart symbol index to file
    await writeSymbolIndex(rootPath, symbolIndex);
    
    return symbolIndex;
  } catch (error) {
    console.error('Error creating smart symbol index:', error);
    throw error;
  }
};

/**
 * Updates the smart symbol index for a changed file
 */
export const updateSmartSymbolIndex = async (
  rootPath: string,
  existingIndex: SmartSymbolIndex,
  changedFilePath: string,
  ignoredPatterns: string[] = []
): Promise<SmartSymbolIndex> => {
  try {
    // Create a deep copy of the existing index to avoid modifying the original
    const updatedIndex: SmartSymbolIndex = JSON.parse(JSON.stringify(existingIndex));
    
    // Normalize the changed file path
    const normalizedChangedPath = normalizeFilePath(changedFilePath, rootPath);
    
    // Skip if not a file we should analyze
    if (!isAnalyzableFile(changedFilePath)) {
      return updatedIndex;
    }
    
    // If the file was deleted
    if (!await fs.pathExists(changedFilePath)) {
      // Remove all symbols from this file
      for (const symbolId in updatedIndex.symbols) {
        if (updatedIndex.symbols[symbolId].file === normalizedChangedPath) {
          delete updatedIndex.symbols[symbolId];
        }
      }
      
      // Remove references to symbols from this file
      for (const symbolId in updatedIndex.symbols) {
        const symbol = updatedIndex.symbols[symbolId];
        
        // Remove references from the deleted file
        if (symbol.references[normalizedChangedPath]) {
          delete symbol.references[normalizedChangedPath];
        }
        
        // Remove calls to symbols in the deleted file
        symbol.calls = symbol.calls.filter(call => {
          // Check if the call is to a symbol in the deleted file
          const targetSymbolId = Object.keys(updatedIndex.symbols).find(id => {
            const targetSymbol = updatedIndex.symbols[id];
            return targetSymbol.file === normalizedChangedPath && targetSymbol.name === call.symbolName;
          });
          
          return !targetSymbolId;
        });
      }
      
      // Write the updated index to file
      await writeSymbolIndex(rootPath, updatedIndex);
      
      return updatedIndex;
    }
    
    // Map to track symbols by file (for reference resolution)
    const fileSymbolMap: Record<string, string[]> = {};
    
    // Build the file-symbol map from the existing index
    for (const symbolId in updatedIndex.symbols) {
      const symbol = updatedIndex.symbols[symbolId];
      if (!fileSymbolMap[symbol.file]) {
        fileSymbolMap[symbol.file] = [];
      }
      fileSymbolMap[symbol.file].push(symbolId);
    }
    
    // Remove all symbols from the changed file
    for (const symbolId in updatedIndex.symbols) {
      if (updatedIndex.symbols[symbolId].file === normalizedChangedPath) {
        delete updatedIndex.symbols[symbolId];
      }
    }
    
    // Remove the file from the file-symbol map
    delete fileSymbolMap[normalizedChangedPath];
    
    // Extract new symbols from the changed file
    const newSymbols = await extractSymbols(changedFilePath, normalizedChangedPath);
    
    // Add new symbols to the index
    for (const symbol of newSymbols) {
      const symbolId = `${symbol.file}:${symbol.name}`;
      updatedIndex.symbols[symbolId] = {
        ...symbol,
        references: {},
        calls: []
      };
      
      // Update the file-symbol map
      if (!fileSymbolMap[symbol.file]) {
        fileSymbolMap[symbol.file] = [];
      }
      fileSymbolMap[symbol.file].push(symbolId);
    }
    
    // Remove references from the changed file in other symbols
    for (const symbolId in updatedIndex.symbols) {
      const symbol = updatedIndex.symbols[symbolId];
      
      // Remove references from the changed file
      if (symbol.references[normalizedChangedPath]) {
        delete symbol.references[normalizedChangedPath];
      }
      
      // Remove calls to symbols that were in the changed file
      symbol.calls = symbol.calls.filter(call => {
        const isCallFromChangedFile = call.symbolName.startsWith(`${normalizedChangedPath}:`);
        return !isCallFromChangedFile;
      });
    }
    
    // Resolve references and calls for the changed file
    await resolveReferencesAndCalls(
      changedFilePath, 
      normalizedChangedPath, 
      updatedIndex, 
      fileSymbolMap
    );
    
    // Write the updated index to file
    await writeSymbolIndex(rootPath, updatedIndex);
    
    return updatedIndex;
  } catch (error) {
    console.error('Error updating smart symbol index:', error);
    // If anything goes wrong during the update, return the original index unchanged
    return existingIndex;
  }
};

/**
 * Extracts symbols from a file
 */
const extractSymbols = async (
  filePath: string,
  normalizedPath: string
): Promise<SymbolInfo[]> => {
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
    
    const symbols: SymbolInfo[] = [];
    const lineMap = computeLineStarts(fileContent);
    
    // Recursively visit nodes to extract symbols
    const visit = (node: ts.Node) => {
      try {
        // Extract function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          const name = node.name.text;
          const startPos = node.getStart(sourceFile);
          const lineNumber = getLineNumber(sourceFile, startPos);
          
          // Extract parameters
          const parameters: ParameterInfo[] = node.parameters.map(param => {
            const paramName = param.name.getText(sourceFile);
            const paramType = param.type 
              ? param.type.getText(sourceFile) 
              : 'any';
            
            return {
              name: paramName,
              type: paramType,
              description: '' // Will be filled by AI later
            };
          });
          
          // Extract return type
          const returnType: ReturnTypeInfo = {
            type: node.type ? node.type.getText(sourceFile) : 'void',
            description: '' // Will be filled by AI later
          };
          
          symbols.push({
            name,
            type: 'function',
            file: normalizedPath,
            defined_at: `line ${lineNumber}`,
            description: '', // Will be filled by AI later
            parameters,
            return: returnType,
            references: {},
            calls: []
          });
        }
        
        // Extract class declarations
        else if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const startPos = node.getStart(sourceFile);
          const lineNumber = getLineNumber(sourceFile, startPos);
          
          symbols.push({
            name,
            type: 'class',
            file: normalizedPath,
            defined_at: `line ${lineNumber}`,
            description: '', // Will be filled by AI later
            references: {},
            calls: []
          });
          
          // Process class methods
          node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
              const methodName = member.name.getText(sourceFile);
              const startPos = member.getStart(sourceFile);
              const lineNumber = getLineNumber(sourceFile, startPos);
              
              // Extract parameters
              const parameters: ParameterInfo[] = member.parameters.map(param => {
                const paramName = param.name.getText(sourceFile);
                const paramType = param.type 
                  ? param.type.getText(sourceFile) 
                  : 'any';
                
                return {
                  name: paramName,
                  type: paramType,
                  description: '' // Will be filled by AI later
                };
              });
              
              // Extract return type
              const returnType: ReturnTypeInfo = {
                type: member.type ? member.type.getText(sourceFile) : 'void',
                description: '' // Will be filled by AI later
              };
              
              symbols.push({
                name: `${name}.${methodName}`,
                type: 'method',
                file: normalizedPath,
                defined_at: `line ${lineNumber}`,
                description: '', // Will be filled by AI later
                parameters,
                return: returnType,
                references: {},
                calls: []
              });
            }
          });
        }
        
        // Extract interface declarations
        else if (ts.isInterfaceDeclaration(node) && node.name) {
          const name = node.name.text;
          const startPos = node.getStart(sourceFile);
          const lineNumber = getLineNumber(sourceFile, startPos);
          
          symbols.push({
            name,
            type: 'interface',
            file: normalizedPath,
            defined_at: `line ${lineNumber}`,
            description: '', // Will be filled by AI later
            references: {},
            calls: []
          });
        }
        
        // Extract type aliases
        else if (ts.isTypeAliasDeclaration(node) && node.name) {
          const name = node.name.text;
          const startPos = node.getStart(sourceFile);
          const lineNumber = getLineNumber(sourceFile, startPos);
          
          symbols.push({
            name,
            type: 'type',
            file: normalizedPath,
            defined_at: `line ${lineNumber}`,
            description: '', // Will be filled by AI later
            references: {},
            calls: []
          });
        }
        
        // Extract enum declarations
        else if (ts.isEnumDeclaration(node) && node.name) {
          const name = node.name.text;
          const startPos = node.getStart(sourceFile);
          const lineNumber = getLineNumber(sourceFile, startPos);
          
          symbols.push({
            name,
            type: 'enum',
            file: normalizedPath,
            defined_at: `line ${lineNumber}`,
            description: '', // Will be filled by AI later
            references: {},
            calls: []
          });
        }
        
        // Extract variable declarations
        else if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(declaration => {
            if (ts.isIdentifier(declaration.name)) {
              const name = declaration.name.text;
              const startPos = declaration.getStart(sourceFile);
              const lineNumber = getLineNumber(sourceFile, startPos);
              
              symbols.push({
                name,
                type: 'variable',
                file: normalizedPath,
                defined_at: `line ${lineNumber}`,
                description: '', // Will be filled by AI later
                references: {},
                calls: []
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
 * Resolves references and calls between symbols
 */
const resolveReferencesAndCalls = async (
  filePath: string,
  normalizedPath: string,
  symbolIndex: SmartSymbolIndex,
  fileSymbolMap: Record<string, string[]>
): Promise<void> => {
  try {
    // Read the file content
    const fileContent = await fs.readFile(filePath, 'utf8');
    
    // Skip files that are too large
    if (fileContent.length > 1000000) { // 1MB limit
      return;
    }
    
    // Create a TypeScript source file
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );
    
    // Get symbols defined in this file
    const fileSymbols = (fileSymbolMap[normalizedPath] || [])
      .map(id => symbolIndex.symbols[id]);
    
    // Track current enclosing symbol
    let currentSymbol: SymbolInfo | null = null;
    
    // Process a function-like declaration to find its enclosing symbol
    const processFunctionLike = (node: ts.Node) => {
      if (!node.parent) {
        return;
      }
      
      // Handle method declarations
      if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent) && node.parent.name) {
        const className = node.parent.name.text;
        const methodName = ts.isIdentifier(node.name) ? node.name.text : '';
        
        if (methodName) {
          const fullName = `${className}.${methodName}`;
          
          currentSymbol = fileSymbols.find(s => s.name === fullName) || null;
        }
      }
      // Handle standalone functions
      else if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        
        currentSymbol = fileSymbols.find(s => s.name === functionName) || null;
      }
    };
    
    // Process an identifier to find references and calls
    const processIdentifier = (node: ts.Identifier, parent: ts.Node) => {
      const identifierName = node.text;
      
      // Skip common identifiers, keywords, etc.
      if (['console', 'require', 'import', 'export', 'this', 'true', 'false', 'null', 'undefined'].includes(identifierName)) {
        return;
      }
      
      // Find all potential target symbols
      const targetSymbolIds = Object.keys(symbolIndex.symbols).filter(id => {
        return symbolIndex.symbols[id].name === identifierName;
      });
      
      if (targetSymbolIds.length === 0) {
        return;
      }
      
      // Handle function/method calls
      if (ts.isCallExpression(parent) && parent.expression === node) {
        const position = node.getStart(sourceFile);
        const lineNumber = getLineNumber(sourceFile, position);
        const contextSnippet = getContextSnippet(sourceFile, position, 3);
        
        for (const targetId of targetSymbolIds) {
          const targetSymbol = symbolIndex.symbols[targetId];
          
          // Add reference to the target symbol
          if (currentSymbol) {
            if (!targetSymbol.references[normalizedPath]) {
              targetSymbol.references[normalizedPath] = { callers: [] };
            }
            
            targetSymbol.references[normalizedPath].callers.push({
              symbolName: currentSymbol.name,
              line: lineNumber,
              contextSnippet
            });
            
            // Add call info to the current symbol
            currentSymbol.calls.push({
              symbolName: targetSymbol.name,
              line: lineNumber
            });
          }
        }
      }
    };
    
    // Recursively visit nodes
    const visit = (node: ts.Node) => {
      try {
        // Track the current symbol for function-like declarations
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
          processFunctionLike(node);
        }
        
        // Process identifiers for references and calls
        if (ts.isIdentifier(node) && node.parent) {
          processIdentifier(node, node.parent);
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
  } catch (error) {
    console.error(`Error resolving references in ${filePath}:`, error);
  }
};

/**
 * Writes the symbol index to a file
 */
const writeSymbolIndex = async (
  rootPath: string,
  symbolIndex: SmartSymbolIndex
): Promise<void> => {
  try {
    // Create the output directory if it doesn't exist
    await ensureCursorTestDir(rootPath);
    
    // Write the index to file
    await writeCursorTestFile(rootPath, OUTPUT_FILE, symbolIndex);
    
    console.log(`Smart symbol index written to ${path.join(rootPath, OUTPUT_DIR, OUTPUT_FILE)}`);
  } catch (error) {
    console.error('Error writing symbol index:', error);
    throw error;
  }
}; 