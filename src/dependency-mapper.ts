import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import { DependencyMap, FileDependencyInfo, ImportInfo } from './types/dependency-map';
import { 
  ANALYZABLE_EXTENSIONS, 
  ALWAYS_IGNORED_DIRS, 
  MAX_FILES_TO_PROCESS,
  normalizeFilePath,
  isAnalyzableFile,
  getProjectFiles
} from './utils/file-system';
import { arraysHaveSameItems } from './utils/ts-analyzer';
import { writeCursorTestFile } from './utils/workspace';

/**
 * Creates a complete dependency map for a project
 */
export const createDependencyMap = async (
  rootPath: string,
  ignoredPatterns: string[] = []
): Promise<DependencyMap> => {
  try {
    // Get all project files
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Safety check - if there are too many files, log a warning and limit processing
    if (projectFiles.length > MAX_FILES_TO_PROCESS) {
      console.warn(`Project contains ${projectFiles.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
      projectFiles.length = MAX_FILES_TO_PROCESS;
    }
    
    // Initialize the dependency map
    const dependencyMap: DependencyMap = { files: {} };
    
    // Process each file to build the dependency graph
    for (const filePath of projectFiles) {
      const normalizedPath = normalizeFilePath(filePath, rootPath);
      
      // Skip if not a file we should analyze
      if (!isAnalyzableFile(normalizedPath)) {
        continue;
      }
      
      // Initialize entry in dependency map if it doesn't exist
      if (!dependencyMap.files[normalizedPath]) {
        dependencyMap.files[normalizedPath] = {
          imports: [],
          importedBy: []
        };
      }
      
      // Parse the file to extract imports
      const imports = await parseFileImports(path.join(rootPath, normalizedPath), rootPath);
      
      // Add import information to the file entry
      dependencyMap.files[normalizedPath].imports = imports;
      
      // Build the reverse dependencies (importedBy)
      for (const importInfo of imports) {
        const importedFile = importInfo.from;
        
        // Initialize entry for imported file if it doesn't exist
        if (!dependencyMap.files[importedFile]) {
          dependencyMap.files[importedFile] = {
            imports: [],
            importedBy: []
          };
        }
        
        // Add this file to the importedBy list of the imported file
        dependencyMap.files[importedFile].importedBy.push({
          from: normalizedPath,
          imports: importInfo.imports
        });
      }
    }
    
    // Write the dependency map to file
    await writeCursorTestFile(rootPath, 'dependency-map.json', dependencyMap);
    
    return dependencyMap;
  } catch (error) {
    console.error('Error creating dependency map:', error);
    throw error;
  }
};

/**
 * Updates an existing dependency map based on a changed file
 */
export const updateDependencyMap = async (
  rootPath: string,
  existingMap: DependencyMap,
  changedFilePath: string,
  ignoredPatterns: string[] = []
): Promise<DependencyMap> => {
  try {
    // Create a deep copy of the existing map to avoid modifying the original
    const updatedMap: DependencyMap = JSON.parse(JSON.stringify(existingMap));
    
    // Normalize the changed file path
    const normalizedChangedPath = normalizeFilePath(changedFilePath, rootPath);
    
    // Skip if not a file we should analyze
    if (!isAnalyzableFile(normalizedChangedPath)) {
      return updatedMap;
    }
    
    // If the file was deleted
    if (!await fs.pathExists(changedFilePath)) {
      // Remove all references to this file from other files' importedBy lists
      if (updatedMap.files[normalizedChangedPath]) {
        for (const importInfo of updatedMap.files[normalizedChangedPath].imports) {
          const importedFile = importInfo.from;
          if (updatedMap.files[importedFile]) {
            updatedMap.files[importedFile].importedBy = updatedMap.files[importedFile].importedBy.filter(
              info => info.from !== normalizedChangedPath
            );
          }
        }
        
        // Remove the file from the dependency map
        delete updatedMap.files[normalizedChangedPath];
      }
      
      return updatedMap;
    }
    
    // Store the old import list to compare with new one
    const oldImports = updatedMap.files[normalizedChangedPath]?.imports || [];
    
    // Reanalyze the changed file
    const newImports = await parseFileImports(changedFilePath, rootPath);
    
    // Initialize or update the file entry
    updatedMap.files[normalizedChangedPath] = updatedMap.files[normalizedChangedPath] || { 
      imports: [], 
      importedBy: [] 
    };
    updatedMap.files[normalizedChangedPath].imports = newImports;
    
    // Find removed imports - need to remove this file from those files' importedBy lists
    for (const oldImport of oldImports) {
      const stillImported = newImports.some(newImport => 
        newImport.from === oldImport.from && 
        arraysHaveSameItems(newImport.imports, oldImport.imports)
      );
      
      if (!stillImported && updatedMap.files[oldImport.from]) {
        // Remove this file from the importedBy list of the previously imported file
        updatedMap.files[oldImport.from].importedBy = updatedMap.files[oldImport.from].importedBy.filter(
          info => info.from !== normalizedChangedPath
        );
      }
    }
    
    // Find new imports - need to add this file to those files' importedBy lists
    for (const newImport of newImports) {
      const wasAlreadyImported = oldImports.some(oldImport => 
        oldImport.from === newImport.from && 
        arraysHaveSameItems(oldImport.imports, newImport.imports)
      );
      
      if (!wasAlreadyImported) {
        // Initialize entry for imported file if it doesn't exist
        if (!updatedMap.files[newImport.from]) {
          updatedMap.files[newImport.from] = {
            imports: [],
            importedBy: []
          };
        }
        
        // Add this file to the importedBy list of the newly imported file
        // Avoid duplicates
        const alreadyInImportedBy = updatedMap.files[newImport.from].importedBy.some(
          info => info.from === normalizedChangedPath
        );
        
        if (!alreadyInImportedBy) {
          updatedMap.files[newImport.from].importedBy.push({
            from: normalizedChangedPath,
            imports: newImport.imports
          });
        } else {
          // Update the existing importedBy entry
          updatedMap.files[newImport.from].importedBy = updatedMap.files[newImport.from].importedBy.map(info => {
            if (info.from === normalizedChangedPath) {
              return {
                from: normalizedChangedPath,
                imports: newImport.imports
              };
            }
            return info;
          });
        }
      }
    }
    
    return updatedMap;
  } catch (error) {
    console.error('Error updating dependency map:', error);
    // If anything goes wrong during the update, return the original map unchanged
    return existingMap;
  }
};

/**
 * Parses a file to extract its imports
 */
const parseFileImports = async (
  filePath: string,
  rootPath: string
): Promise<ImportInfo[]> => {
  try {
    // Skip non-analyzable files
    if (!isAnalyzableFile(filePath)) {
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
    
    const imports: ImportInfo[] = [];
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
                
                const normalizedPath = normalizeFilePath(resolvedPath, rootPath);
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
                
                const normalizedPath = normalizeFilePath(resolvedPath, rootPath);
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