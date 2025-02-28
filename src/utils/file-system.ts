import * as fs from 'fs-extra';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

// Constants used across multiple files
export const ANALYZABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
export const ALWAYS_IGNORED_DIRS = ['node_modules', '.next', 'dist', 'build', '.git', '.vscode'];
export const MAX_FILES_TO_PROCESS = 2000;

export const execAsync = promisify(exec);

/**
 * Normalizes a file path relative to the project root
 * @param filePath - The file path to normalize
 * @param rootPath - The project root path
 * @returns The normalized file path
 */
export const normalizeFilePath = (filePath: string, rootPath: string): string => {
  return path.relative(rootPath, filePath).replace(/\\/g, '/');
};

/**
 * Checks if a file is analyzable based on its extension
 * @param filePath - The file path to check
 * @returns Whether the file is analyzable
 */
export const isAnalyzableFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return ANALYZABLE_EXTENSIONS.includes(ext);
};

/**
 * Parses .gitignore and returns its rules
 * @param rootPath - The project root path
 * @returns Array of gitignore rules
 */
export const parseGitignore = async (rootPath: string): Promise<string[]> => {
  try {
    const gitignorePath = path.join(rootPath, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      const content = await fs.readFile(gitignorePath, 'utf8');
      return content
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line && !line.startsWith('#'));
    }
    return [];
  } catch (error) {
    console.error('Error parsing .gitignore:', error);
    return [];
  }
};

/**
 * Checks if a file path should be ignored based on gitignore patterns
 * @param filePath - The file path to check
 * @param rootPath - The project root path
 * @param ignoredPatterns - Array of patterns to ignore
 * @returns Whether the file should be ignored
 */
export const isIgnored = (filePath: string, rootPath: string, ignoredPatterns: string[]): boolean => {
  const relPath = path.relative(rootPath, filePath);
  
  // Check if the path contains any of the always ignored directories
  if (ALWAYS_IGNORED_DIRS.some(dir => 
    relPath.startsWith(dir + path.sep) || 
    relPath === dir ||
    relPath.includes(path.sep + dir + path.sep)
  )) {
    return true;
  }
  
  // Check against gitignore patterns
  return ignoredPatterns.some(pattern => {
    // Simple pattern matching (can be enhanced for more complex gitignore rules)
    if (pattern.endsWith('/')) {
      // Directory pattern
      return relPath.startsWith(pattern) || relPath.includes(`/${pattern}`);
    }
    // File pattern
    return relPath === pattern || relPath.endsWith(`/${pattern}`) || 
           // Handle wildcard patterns like *.vsix
           (pattern.startsWith('*') && relPath.endsWith(pattern.substring(1)));
  });
};

/**
 * Gets all project files, respecting gitignore rules
 * @param rootPath - The project root path
 * @param ignoredPatterns - Array of patterns to ignore
 * @returns Array of file paths
 */
export const getProjectFiles = async (
  rootPath: string,
  ignoredPatterns: string[] = []
): Promise<string[]> => {
  const result: string[] = [];
  
  // Try to use git ls-files first for better performance
  try {
    const { stdout } = await execAsync('git ls-files', { cwd: rootPath });
    const files = stdout.split('\n').filter(Boolean);
    
    // Convert relative paths to absolute
    return files
      .map(file => path.join(rootPath, file))
      .filter(file => !isIgnored(file, rootPath, ignoredPatterns));
  } catch (error) {
    // Fallback to manual traversal if git is not available
    console.warn('Git ls-files failed, falling back to manual traversal:', error);
    
    const traverseDirectory = async (currentPath: string): Promise<void> => {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        
        if (isIgnored(itemPath, rootPath, ignoredPatterns)) {
          continue;
        }
        
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          await traverseDirectory(itemPath);
        } else {
          result.push(itemPath);
        }
      }
    };
    
    await traverseDirectory(rootPath);
    return result;
  }
};

/**
 * Builds a tree structure from a list of file paths
 * @param paths - Array of file paths
 * @returns Tree structure as a nested object
 */
export const buildTreeFromPaths = (paths: string[]): Record<string, any> => {
  const tree: Record<string, any> = {};
  
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let current = tree;
    
    // Process all directories in the path
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    
    // Add the file (last part)
    const fileName = parts[parts.length - 1];
    current[fileName] = null; // null indicates it's a file
  }
  
  return tree;
};

/**
 * Formats a tree structure as a string
 * @param tree - Tree structure as a nested object
 * @param prefix - Prefix for formatting (used recursively)
 * @returns Formatted tree as a string
 */
export const formatTree = (tree: Record<string, any>, prefix: string = ''): string => {
  let result = '';
  const entries = Object.entries(tree);
  
  entries.forEach(([name, subtree], index) => {
    const isLast = index === entries.length - 1;
    const linePrefix = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    
    result += `${prefix}${linePrefix}${name}\n`;
    
    if (subtree !== null) {
      result += formatTree(subtree, `${prefix}${childPrefix}`);
    }
  });
  
  return result;
};