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
        let currentSymbol: any | null = null;
        
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
                  (dep: any) => dep.name === currentSymbol!.name && dep.filePath === currentSymbol!.filePath
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
  }
}; 