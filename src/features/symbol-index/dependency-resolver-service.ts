import * as ts from 'typescript';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { FileSystemService } from '@/shared/services/file-system-service';
import { TsAnalyzerService } from '@/shared/services/ts-analyzer-service';

/**
 * Service for resolving dependencies between symbols
 */
export const DependencyResolverService = {
  /**
   * Resolves dependencies between symbols in the project
   * @param symbolIndex - The symbol index
   * @param projectFiles - List of project files
   * @param rootPath - Project root path
   */
  async resolveDependencies(
    symbolIndex: SymbolIndex,
    projectFiles: string[],
    rootPath: string
  ): Promise<void> {
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
      const flatSymbolMap: Record<string, any> = {};
      
      // Build the symbol map with compound keys for uniqueness
      for (const filePath in symbolIndex) {
        for (const symbol of symbolIndex[filePath]) {
          const key = `${filePath}:${symbol.name}`;
          flatSymbolMap[key] = symbol;
        }
      }
      
      // Excluded identifiers that are built-in or commonly used
      const excludedIdentifiers = new Set([
        'console', 'require', 'import', 'export', 'this', 'true', 'false',
        'null', 'undefined', 'module', 'exports', 'process', 'window',
        'document', 'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
        'Map', 'Set', 'Promise', 'JSON', 'Math', 'Date', 'Error'
      ]);
      
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
        
        // Stack to track nested container symbols
        const containerStack: any[] = [];
        
        // Recursively visit nodes
        const visit = (node: ts.Node) => {
          try {
            // Track the container symbol for various kinds of declarations
            let enteredNewContainer = false;
            
            if (ts.isFunctionDeclaration(node) || 
                ts.isMethodDeclaration(node) || 
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node) || 
                ts.isArrowFunction(node) ||
                ts.isFunctionExpression(node)) {
              
              let containerSymbol = null;
              
              // Get the container symbol based on the node type
              if (ts.isFunctionDeclaration(node) && node.name) {
                const functionName = node.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === functionName) || null;
              }
              else if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent) && node.parent.name) {
                const className = node.parent.name.text;
                const methodName = ts.isIdentifier(node.name) ? node.name.text : '';
                
                if (methodName) {
                  const fullName = `${className}.${methodName}`;
                  const symbols = symbolIndex[normalizedPath] || [];
                  containerSymbol = symbols.find(s => s.name === fullName) || null;
                }
              }
              else if (ts.isClassDeclaration(node) && node.name) {
                const className = node.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === className) || null;
              }
              else if (ts.isInterfaceDeclaration(node) && node.name) {
                const interfaceName = node.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === interfaceName) || null;
              }
              else if (ts.isTypeAliasDeclaration(node) && node.name) {
                const typeName = node.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === typeName) || null;
              }
              else if (ts.isEnumDeclaration(node) && node.name) {
                const enumName = node.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === enumName) || null;
              }
              else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name && ts.isIdentifier(node.parent.name)) {
                const variableName = node.parent.name.text;
                const symbols = symbolIndex[normalizedPath] || [];
                containerSymbol = symbols.find(s => s.name === variableName) || null;
              }
              
              if (containerSymbol) {
                containerStack.push(containerSymbol);
                enteredNewContainer = true;
              }
            }
            
            // Process identifier references to track dependencies
            if (ts.isIdentifier(node)) {
              const identifierName = node.text;
              
              // Skip common identifiers, keywords, etc.
              if (excludedIdentifiers.has(identifierName)) {
                return;
              }
              
              // Skip if this is a declaration position, not a reference
              if (this.isDeclarationPosition(node)) {
                return;
              }
              
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
              
              if (!targetSymbol) {
                return;
              }
              
              // Get the current container symbol (closest enclosing declaration)
              const currentSymbol = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
              
              if (currentSymbol) {
                // Skip self-references
                if (currentSymbol.name === targetSymbol.name && currentSymbol.filePath === targetSymbol.filePath) {
                  return;
                }
                
                // Add dependency relationship
                const existingDependency = currentSymbol.depends_on.find(
                  (dep: any) => dep.name === targetSymbol.name && dep.filePath === targetSymbol.filePath
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
                  (dep: any) => dep.name === currentSymbol.name && dep.filePath === currentSymbol.filePath
                );
                
                if (!existingDependent) {
                  targetSymbol.dependents.push({
                    name: currentSymbol.name,
                    filePath: currentSymbol.filePath,
                    line: lineNumber,
                    contextSnippet
                  });
                }
              } else {
                // Handle top-level references (outside any container)
                // These will be recorded as file-level dependencies
                const fileSymbols = symbolIndex[normalizedPath] || [];
                
                // Try to find an existing file-level symbol (representing the module/file)
                let fileSymbol = fileSymbols.find(s => s.name === '__file__');
                
                // Create a file-level symbol if none exists
                if (!fileSymbol) {
                  fileSymbol = {
                    name: '__file__',
                    type: 'other',
                    filePath: normalizedPath,
                    location: { line: 1, character: 0 },
                    docstring: '/** File-level symbol */',
                    snippet: '',
                    dependents: [],
                    depends_on: []
                  };
                  
                  if (!symbolIndex[normalizedPath]) {
                    symbolIndex[normalizedPath] = [];
                  }
                  
                  symbolIndex[normalizedPath].push(fileSymbol);
                }
                
                // Add dependency relationship for file-level symbol
                const existingDependency = fileSymbol.depends_on.find(
                  (dep: any) => dep.name === targetSymbol.name && dep.filePath === targetSymbol.filePath
                );
                
                if (!existingDependency) {
                  fileSymbol.depends_on.push({
                    name: targetSymbol.name,
                    filePath: targetSymbol.filePath,
                    line: lineNumber
                  });
                }
                
                // Add to target symbol's dependents list
                const existingDependent = targetSymbol.dependents.find(
                  (dep: any) => dep.name === fileSymbol.name && dep.filePath === fileSymbol.filePath
                );
                
                if (!existingDependent) {
                  targetSymbol.dependents.push({
                    name: fileSymbol.name,
                    filePath: fileSymbol.filePath,
                    line: lineNumber,
                    contextSnippet
                  });
                }
              }
            }
            
            // Continue with child nodes
            ts.forEachChild(node, visit);
            
            // Remove the container from the stack if we entered a new one
            if (enteredNewContainer && containerStack.length > 0) {
              containerStack.pop();
            }
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
  },
  
  /**
   * Determines if an identifier is in a declaration position
   * @param node - The identifier node
   * @returns True if this is a declaration, false if it's a reference
   */
  isDeclarationPosition(node: ts.Identifier): boolean {
    const parent = node.parent;
    
    // Various declaration patterns to check
    if (!parent) {return false;}
    
    // Function/method/class/interface/etc. declarations
    if ((ts.isFunctionDeclaration(parent) || 
         ts.isMethodDeclaration(parent) || 
         ts.isClassDeclaration(parent) || 
         ts.isInterfaceDeclaration(parent) ||
         ts.isTypeAliasDeclaration(parent) ||
         ts.isEnumDeclaration(parent)) && 
        parent.name === node) {
      return true;
    }
    
    // Variable declarations
    if (ts.isVariableDeclaration(parent) && parent.name === node) {
      return true;
    }
    
    // Parameter declarations
    if (ts.isParameter(parent) && parent.name === node) {
      return true;
    }
    
    // Property declarations
    if (ts.isPropertyDeclaration(parent) && parent.name === node) {
      return true;
    }
    
    // Property assignments in object literals (potential declaration)
    if (ts.isPropertyAssignment(parent) && parent.name === node) {
      return true;
    }
    
    // Named imports
    if (ts.isImportSpecifier(parent) && parent.name === node) {
      return true;
    }
    
    // Default imports
    if (ts.isImportClause(parent) && parent.name === node) {
      return true;
    }
    
    return false;
  }
}; 