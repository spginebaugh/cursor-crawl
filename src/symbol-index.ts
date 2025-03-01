import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';

// Import types and services
import {
  SymbolIndexEntry,
  SymbolIndex
} from '@/types/symbol-index';
import { FileSystemService, MAX_FILES_TO_PROCESS } from '@/services/file-system-service';
import { TsAnalyzerService } from '@/services/ts-analyzer-service';
import { SymbolIndexService } from '@/services/symbol-index-service';

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
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
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
      if (!FileSystemService.isAnalyzableFile(filePath)) {
        continue;
      }
      
      progress?.report({ 
        message: `Processing file ${i + 1}/${projectFiles.length}: ${path.basename(filePath)}` 
      });
      
      const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
      
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
 * Extracts JSDoc comment from a node if present
 * @param node - The TypeScript node
 * @param sourceFile - The source file
 * @returns The JSDoc comment text or empty string
 */
const extractJSDocComment = (node: ts.Node, sourceFile: ts.SourceFile): string => {
  const jsDocComments = ts.getJSDocCommentsAndTags(node) as ts.JSDoc[];
  
  if (jsDocComments && jsDocComments.length > 0) {
    // Get the first JSDoc comment
    const jsDoc = jsDocComments[0];
    
    // Extract the JSDoc text
    if (jsDoc.getFullText) {
      return jsDoc.getFullText(sourceFile);
    }
  }
  
  return '';
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
    if (!FileSystemService.isAnalyzableFile(filePath)) {
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
        // Check if node has JSDoc comments
        const hasJSDoc = ts.getJSDocTags(node).length > 0;
        // Extract JSDoc comment text if present
        const jsDocComment = hasJSDoc ? extractJSDocComment(node, sourceFile) : '';
        
        // Extract function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
          const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'function',
            filePath: normalizedPath,
            location,
            docstring: jsDocComment || '/** */', // Use actual JSDoc or placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract class declarations
        else if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
          const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'class',
            filePath: normalizedPath,
            location,
            docstring: jsDocComment || '/** */', // Use actual JSDoc or placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
          
          // Process class methods
          node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
              const methodName = member.name.getText(sourceFile);
              const methodHasJSDoc = ts.getJSDocTags(member).length > 0;
              const methodJSDocComment = methodHasJSDoc ? extractJSDocComment(member, sourceFile) : '';
              const location = TsAnalyzerService.getLineAndCharacter(sourceFile, member);
              const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, member);
              
              symbols.push({
                name: `${name}.${methodName}`,
                type: 'method',
                filePath: normalizedPath,
                location,
                docstring: methodJSDocComment || '/** */', // Use actual JSDoc or placeholder
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
          const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
          const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'interface',
            filePath: normalizedPath,
            location,
            docstring: jsDocComment || '/** */', // Use actual JSDoc or placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract type aliases
        else if (ts.isTypeAliasDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
          const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'type',
            filePath: normalizedPath,
            location,
            docstring: jsDocComment || '/** */', // Use actual JSDoc or placeholder
            snippet,
            dependents: [],
            depends_on: []
          });
        }
        
        // Extract enum declarations
        else if (ts.isEnumDeclaration(node) && node.name) {
          const name = node.name.text;
          const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
          const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
          
          symbols.push({
            name,
            type: 'enum',
            filePath: normalizedPath,
            location,
            docstring: jsDocComment || '/** */', // Use actual JSDoc or placeholder
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
              const varJSDocComment = varHasJSDoc ? extractJSDocComment(declaration, sourceFile) : '';
              const location = TsAnalyzerService.getLineAndCharacter(sourceFile, declaration);
              const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, declaration);
              
              symbols.push({
                name,
                type: 'variable',
                filePath: normalizedPath,
                location,
                docstring: varJSDocComment || '/** */', // Use actual JSDoc or placeholder
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
    // Create a TypeScript compiler host and program for symbol resolution
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.CommonJS,
      allowJs: true,
      checkJs: false,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };

    // Only include analyzable files in the program
    const analyzableFiles = projectFiles.filter(file => FileSystemService.isAnalyzableFile(file));
    
    // Create program and type checker
    const program = ts.createProgram(analyzableFiles, compilerOptions);
    const typeChecker = program.getTypeChecker();
    
    // Create a flat map of all symbols for easy lookup (by name and file path)
    const flatSymbolMap: Record<string, SymbolIndexEntry> = {};
    
    // Build the symbol map with compound keys for uniqueness
    for (const filePath in symbolIndex) {
      for (const symbol of symbolIndex[filePath]) {
        const key = `${filePath}:${symbol.name}`;
        flatSymbolMap[key] = symbol;
      }
    }
    
    // Process each file to find dependencies
    for (const filePath of projectFiles) {
      if (!FileSystemService.isAnalyzableFile(filePath)) {
        continue;
      }
      
      const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
      
      // Skip if the file isn't in our index
      if (!symbolIndex[normalizedPath]) {
        continue;
      }
      
      // Get the source file from the program
      const sourceFile = program.getSourceFile(filePath);
      if (!sourceFile) {
        continue;
      }
      
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
            
            // Handle function/method calls
            if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
              const position = node.getStart(sourceFile);
              const lineNumber = TsAnalyzerService.getLineNumber(sourceFile, position);
              const contextSnippet = TsAnalyzerService.getContextSnippet(sourceFile, position, 3);
              
              // Try to resolve the symbol using TypeScript's type checker
              const symbol = typeChecker.getSymbolAtLocation(node);
              if (!symbol) {
                return;
              }
              
              // Get the declaration of the symbol
              const declarations = symbol.getDeclarations();
              if (!declarations || declarations.length === 0) {
                return;
              }
              
              // Find the source file of the declaration
              const declarationSourceFile = declarations[0].getSourceFile();
              if (!declarationSourceFile) {
                return;
              }
              
              // Skip if it's an external library
              const isNodeModule = declarationSourceFile.fileName.includes('node_modules');
              if (isNodeModule) {
                return;
              }
              
              // Get normalized path of the declaration
              const declarationPath = FileSystemService.normalizeFilePath(declarationSourceFile.fileName, rootPath);
              
              // Find the target symbol entry in our index
              const targetFileSymbols = symbolIndex[declarationPath] || [];
              const targetSymbol = targetFileSymbols.find(s => s.name === identifierName);
              
              if (!targetSymbol || !currentSymbol) {
                return;
              }
              
              // Skip self-references
              if (currentSymbol.name === targetSymbol.name && currentSymbol.filePath === targetSymbol.filePath) {
                return;
              }
              
              // Add dependency relationship
              const existingDependency = currentSymbol.depends_on.find(
                dep => dep.name === targetSymbol.name && dep.filePath === targetSymbol.filePath
              );
              
              if (!existingDependency) {
                currentSymbol.depends_on.push({
                  name: targetSymbol.name,
                  filePath: targetSymbol.filePath,
                  line: lineNumber
                });
              }
              
              // Add to target symbol's dependents list
              const existingDependent = targetSymbol.dependents.find(
                dep => dep.name === currentSymbol!.name && dep.filePath === currentSymbol!.filePath
              );
              
              if (!existingDependent) {
                targetSymbol.dependents.push({
                  name: currentSymbol.name,
                  filePath: currentSymbol.filePath,
                  line: lineNumber,
                  contextSnippet
                });
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
    // Write the index to file using the service
    await SymbolIndexService.writeSymbolIndex(rootPath, symbolIndex);
    
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
    const normalizedChangedPath = FileSystemService.normalizeFilePath(changedFilePath, rootPath);
    
    // Skip if not a file we should analyze
    if (!FileSystemService.isAnalyzableFile(changedFilePath)) {
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
            dep.filePath !== normalizedChangedPath
          );
        }
      }
      
      // Write the updated index to file
      await writeSymbolIndex(rootPath, updatedIndex);
      
      return updatedIndex;
    }
    
    // Store existing symbols from the changed file to preserve docstrings
    const existingFileSymbols = updatedIndex[normalizedChangedPath] || [];
    
    // Remove all symbols from the changed file
    delete updatedIndex[normalizedChangedPath];
    
    // Extract new symbols from the changed file
    const newSymbols = await extractSymbols(changedFilePath, normalizedChangedPath, rootPath);
    
    // Preserve docstrings from existing symbols when they match new symbols
    const mergedSymbols = newSymbols.map(newSymbol => {
      // Try to find a matching symbol in the existing file symbols
      const existingSymbol = existingFileSymbols.find(
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
    
    // Add merged symbols to the index
    if (mergedSymbols.length > 0) {
      updatedIndex[normalizedChangedPath] = mergedSymbols;
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
        
        // Remove dependencies on symbols in changed file
        symbol.depends_on = symbol.depends_on.filter(dep => 
          dep.filePath !== normalizedChangedPath
        );
      }
    }
    
    // Get all project files to resolve dependencies
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
    // Resolve dependencies using our updated method
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