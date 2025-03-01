import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import { SymbolIndex, DependencyInfo, DependentInfo } from '@/shared/types/symbol-index';
import { 
  ANALYZABLE_EXTENSIONS, 
  ALWAYS_IGNORED_DIRS, 
  MAX_FILES_TO_PROCESS,
  FileSystemService
} from './shared/services/file-system-service';
import { WorkspaceService } from './shared/services/workspace-service';

/**
 * Creates dependency information for a project and incorporates it into a symbol index
 */
export const buildDependencyGraph = async (
  rootPath: string,
  symbolIndex: SymbolIndex = {},
  ignoredPatterns: string[] = []
): Promise<SymbolIndex> => {
  try {
    // Get all project files
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
    // Safety check - if there are too many files, log a warning and limit processing
    if (projectFiles.length > MAX_FILES_TO_PROCESS) {
      console.warn(`Project contains ${projectFiles.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
      projectFiles.length = MAX_FILES_TO_PROCESS;
    }
    
    // Initialize the symbol index with empty arrays for files that don't have entries yet
    for (const filePath of projectFiles) {
      const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
      
      // Skip if not a file we should analyze
      if (!FileSystemService.isAnalyzableFile(normalizedPath)) {
        continue;
      }
      
      // Initialize entry in symbol index if it doesn't exist
      if (!symbolIndex[normalizedPath]) {
        symbolIndex[normalizedPath] = [];
      }
    }
    
    // Process each file to build the dependency graph
    for (const filePath of projectFiles) {
      const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
      
      // Skip if not a file we should analyze
      if (!FileSystemService.isAnalyzableFile(normalizedPath)) {
        continue;
      }
      
      // Parse the file to extract imports
      const imports = await parseFileImports(path.join(rootPath, normalizedPath), rootPath);
      
      // Add import information to the file's symbols
      for (const importInfo of imports) {
        const importedFile = importInfo.from;
        const importedSymbols = importInfo.imports;
        
        // Find symbols in the current file
        const fileSymbols = symbolIndex[normalizedPath] || [];
        
        // Find symbols in the imported file
        const importedFileSymbols = symbolIndex[importedFile] || [];
        
        // Link the dependencies
        for (const symbol of fileSymbols) {
          // For each imported symbol, create a dependency relationship
          for (const importedSymbolName of importedSymbols) {
            // Skip default and wildcard imports as they're harder to track
            if (importedSymbolName === 'default' || importedSymbolName === '*') {
              continue;
            }
            
            // Find the matching symbol in the imported file
            const importedSymbol = importedFileSymbols.find(s => s.name === importedSymbolName);
            
            if (importedSymbol) {
              // Create a dependency from current symbol to imported symbol
              const dependency: DependencyInfo = {
                name: importedSymbol.name,
                filePath: importedFile,
                line: importedSymbol.location.line
              };
              
              // Add to depends_on if not already there
              if (!symbol.depends_on.some(d => d.name === dependency.name && d.filePath === dependency.filePath)) {
                symbol.depends_on.push(dependency);
              }
              
              // Create a dependent from imported symbol to current symbol
              const dependent: DependentInfo = {
                name: symbol.name,
                filePath: normalizedPath,
                line: symbol.location.line
              };
              
              // Add to dependents if not already there
              if (!importedSymbol.dependents.some(d => d.name === dependent.name && d.filePath === dependent.filePath)) {
                importedSymbol.dependents.push(dependent);
              }
            }
          }
        }
      }
    }
    
    // Write the dependency-enhanced symbol index to file
    await WorkspaceService.writeCursorTestFile(rootPath, 'symbol-index.json', symbolIndex);
    
    return symbolIndex;
  } catch (error) {
    console.error('Error building dependency graph:', error);
    throw error;
  }
};

/**
 * Updates the dependency information in an existing symbol index based on a changed file
 */
export const updateDependencyGraph = async (
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
    if (!FileSystemService.isAnalyzableFile(normalizedChangedPath)) {
      return updatedIndex;
    }
    
    // If the file was deleted
    if (!await fs.pathExists(changedFilePath)) {
      // Clear dependencies and dependents for the deleted file
      if (updatedIndex[normalizedChangedPath]) {
        // For each symbol in the deleted file
        for (const symbol of updatedIndex[normalizedChangedPath]) {
          // Remove this symbol from the dependents list of any symbols it depends on
          for (const dependency of symbol.depends_on) {
            const dependencyFile = dependency.filePath;
            const dependencySymbol = dependency.name;
            
            if (updatedIndex[dependencyFile]) {
              // Find the symbol and remove this symbol from its dependents
              const depSymbol = updatedIndex[dependencyFile].find(s => s.name === dependencySymbol);
              if (depSymbol) {
                depSymbol.dependents = depSymbol.dependents.filter(
                  d => d.filePath !== normalizedChangedPath
                );
              }
            }
          }
        }
        
        // Remove the file from the symbol index
        delete updatedIndex[normalizedChangedPath];
      }
      
      return updatedIndex;
    }
    
    // Reanalyze the changed file
    const newImports = await parseFileImports(changedFilePath, rootPath);
    
    // Clear existing dependencies for this file's symbols
    if (updatedIndex[normalizedChangedPath]) {
      // For each symbol in the file
      for (const symbol of updatedIndex[normalizedChangedPath]) {
        // Remove this symbol from dependents lists of other symbols
        for (const dependency of symbol.depends_on) {
          const dependencyFile = dependency.filePath;
          const dependencySymbol = dependency.name;
          
          if (updatedIndex[dependencyFile]) {
            // Find the symbol and remove this symbol from its dependents
            const depSymbol = updatedIndex[dependencyFile].find(s => s.name === dependencySymbol);
            if (depSymbol) {
              depSymbol.dependents = depSymbol.dependents.filter(
                d => !(d.filePath === normalizedChangedPath && d.name === symbol.name)
              );
            }
          }
        }
        
        // Clear this symbol's dependencies
        symbol.depends_on = [];
      }
    } else {
      // If the file wasn't in the index before, initialize it
      updatedIndex[normalizedChangedPath] = [];
    }
    
    // Add new dependencies based on the new imports
    for (const importInfo of newImports) {
      const importedFile = importInfo.from;
      const importedSymbols = importInfo.imports;
      
      // Skip if the imported file doesn't exist in the index
      if (!updatedIndex[importedFile]) {
        continue;
      }
      
      // Find symbols in the current file
      const fileSymbols = updatedIndex[normalizedChangedPath] || [];
      
      // Find symbols in the imported file
      const importedFileSymbols = updatedIndex[importedFile] || [];
      
      // Link the dependencies
      for (const symbol of fileSymbols) {
        // For each imported symbol, create a dependency relationship
        for (const importedSymbolName of importedSymbols) {
          // Skip default and wildcard imports as they're harder to track
          if (importedSymbolName === 'default' || importedSymbolName === '*') {
            continue;
          }
          
          // Find the matching symbol in the imported file
          const importedSymbol = importedFileSymbols.find(s => s.name === importedSymbolName);
          
          if (importedSymbol) {
            // Create a dependency from current symbol to imported symbol
            const dependency: DependencyInfo = {
              name: importedSymbol.name,
              filePath: importedFile,
              line: importedSymbol.location.line
            };
            
            // Add to depends_on if not already there
            if (!symbol.depends_on.some(d => d.name === dependency.name && d.filePath === dependency.filePath)) {
              symbol.depends_on.push(dependency);
            }
            
            // Create a dependent from imported symbol to current symbol
            const dependent: DependentInfo = {
              name: symbol.name,
              filePath: normalizedChangedPath,
              line: symbol.location.line
            };
            
            // Add to dependents if not already there
            if (!importedSymbol.dependents.some(d => d.name === dependent.name && d.filePath === dependent.filePath)) {
              importedSymbol.dependents.push(dependent);
            }
          }
        }
      }
    }
    
    return updatedIndex;
  } catch (error) {
    console.error('Error updating dependency graph:', error);
    // If anything goes wrong during the update, return the original index unchanged
    return existingIndex;
  }
};

/**
 * Parses a file to extract its imports
 */
const parseFileImports = async (
  filePath: string,
  rootPath: string
): Promise<Array<{ from: string; imports: string[] }>> => {
  try {
    // Skip non-analyzable files
    if (!FileSystemService.isAnalyzableFile(filePath)) {
      return [];
    }
    
    // Additional safety check - skip any files in node_modules or .next
    const relativePath = path.relative(rootPath, filePath);
    if (ALWAYS_IGNORED_DIRS.some(dir => 
      relativePath.startsWith(`${dir}${path.sep}`) || 
      relativePath.includes(`${path.sep}${dir}${path.sep}`) ||
      relativePath === dir
    )) {
      return [];
    }
    
    // Read the file content
    const fileContent = await fs.readFile(filePath, 'utf8');
    
    // Skip files that are too large (likely minified files)
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
    
    const imports: Array<{ from: string; imports: string[] }> = [];
    const processedImports = new Set<string>();
    
    // Recursive function to visit nodes in the AST
    const visit = (node: ts.Node) => {
      try {
        // Handle import declarations (import { x } from 'y')
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          
          if (ts.isStringLiteral(moduleSpecifier)) {
            // Clean the import path by removing query strings or hash fragments
            let importPath = moduleSpecifier.text;
            importPath = importPath.split('?')[0].split('#')[0];
            
            // Skip node_modules and absolute imports
            if (importPath.startsWith('.')) {
              const resolvedPath = resolveImportPath(importPath, filePath, rootPath);
              
              if (resolvedPath) {
                const importedSymbols: string[] = [];
                
                // Extract imported symbols
                if (node.importClause) {
                  // Handle default imports (import x from 'y')
                  if (node.importClause.name) {
                    importedSymbols.push('default');
                  }
                  
                  // Handle named imports (import { x, y } from 'z')
                  if (node.importClause.namedBindings) {
                    if (ts.isNamedImports(node.importClause.namedBindings)) {
                      node.importClause.namedBindings.elements.forEach(element => {
                        importedSymbols.push(element.name.text);
                      });
                    }
                    // Handle namespace imports (import * as x from 'y')
                    else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                      importedSymbols.push('*');
                    }
                  }
                }
                
                const normalizedPath = FileSystemService.normalizeFilePath(resolvedPath, rootPath);
                const importKey = `${normalizedPath}|${importedSymbols.join(',')}`;
                
                // Avoid duplicate imports
                if (!processedImports.has(importKey)) {
                  processedImports.add(importKey);
                  imports.push({
                    from: normalizedPath,
                    imports: importedSymbols
                  });
                }
              }
            }
          }
        }
        
        // Handle export declarations with from clause (export { x } from 'y')
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          if (ts.isStringLiteral(node.moduleSpecifier)) {
            // Clean the import path by removing query strings or hash fragments
            let importPath = node.moduleSpecifier.text;
            importPath = importPath.split('?')[0].split('#')[0];
            
            // Skip node_modules and absolute imports
            if (importPath.startsWith('.')) {
              const resolvedPath = resolveImportPath(importPath, filePath, rootPath);
              
              if (resolvedPath) {
                const exportedSymbols: string[] = [];
                
                // Extract exported symbols
                if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                  node.exportClause.elements.forEach(element => {
                    exportedSymbols.push(element.name.text);
                  });
                } else {
                  exportedSymbols.push('*');
                }
                
                const normalizedPath = FileSystemService.normalizeFilePath(resolvedPath, rootPath);
                const importKey = `${normalizedPath}|${exportedSymbols.join(',')}`;
                
                // Avoid duplicate imports
                if (!processedImports.has(importKey)) {
                  processedImports.add(importKey);
                  imports.push({
                    from: normalizedPath,
                    imports: exportedSymbols
                  });
                }
              }
            }
          }
        }
        
        // Recursively visit children - with a maximum depth limit to avoid stack overflows
        try {
          ts.forEachChild(node, visit);
        } catch (childError) {
          // Log and continue if there's an error visiting children
          console.warn(`Error visiting AST children in ${filePath}:`, childError);
        }
      } catch (nodeError) {
        // Catch errors at the node level to ensure we can continue processing other nodes
        console.warn(`Error processing AST node in ${filePath}:`, nodeError);
      }
    };
    
    // Start the traversal from the root node
    visit(sourceFile);
    
    return imports;
  } catch (error) {
    console.error(`Error parsing imports for ${filePath}:`, error);
    return [];
  }
};

/**
 * Resolves an import path to an absolute file path
 */
const resolveImportPath = (
  importPath: string,
  importingFilePath: string,
  rootPath: string
): string | null => {
  try {
    // Skip node_modules imports and absolute imports
    if (importPath.includes('node_modules') || !importPath.startsWith('.')) {
      return null;
    }
    
    // Get the directory of the importing file
    const importingDir = path.dirname(importingFilePath);
    
    // Normalize the import path to handle any special characters
    const normalizedImportPath = decodeURIComponent(importPath).replace(/\\/g, '/');
    
    // Resolve the relative import path
    let resolvedPath = path.resolve(importingDir, normalizedImportPath);
    
    // Ensure we're not resolving to a path outside the project or in ignored directories
    const relativePath = path.relative(rootPath, resolvedPath);
    if (relativePath.startsWith('..') || ALWAYS_IGNORED_DIRS.some(dir => 
      relativePath.startsWith(`${dir}${path.sep}`) || 
      relativePath.includes(`${path.sep}${dir}${path.sep}`) ||
      relativePath === dir
    )) {
      return null;
    }
    
    // Check if it's a file or a directory
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      
      if (stats.isDirectory()) {
        // Check for index files in the directory
        for (const ext of ANALYZABLE_EXTENSIONS) {
          const indexFile = path.join(resolvedPath, `index${ext}`);
          if (fs.existsSync(indexFile)) {
            return indexFile;
          }
        }
      } else {
        // It's already a file
        return resolvedPath;
      }
    }
    
    // Try adding extensions
    for (const ext of ANALYZABLE_EXTENSIONS) {
      const pathWithExt = `${resolvedPath}${ext}`;
      if (fs.existsSync(pathWithExt)) {
        return pathWithExt;
      }
    }
    
    // Try special cases for framework-specific paths:
    // Case 1: File might be using a TS path alias or webpack alias
    // For now, just log that we couldn't resolve it
    console.debug(`Could not resolve import path: ${importPath} from ${importingFilePath}`);
    
    return null;
  } catch (error) {
    console.error(`Error resolving import path ${importPath} from ${importingFilePath}:`, error);
    return null;
  }
};