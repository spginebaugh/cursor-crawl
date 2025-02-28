import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { DocstringInfo, DocstringIndex } from './types/docstring-index';

// File extensions to consider for analysis (same as dependency-mapper)
const ANALYZABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

// Directories that should always be ignored (same as dependency-mapper)
const ALWAYS_IGNORED_DIRS = ['node_modules', '.next', 'dist', 'build', '.git', '.vscode'];

// Maximum number of files to process
const MAX_FILES_TO_PROCESS = 2000;

// Load environment variables from .env.local
interface EnvVars {
  OPENAI_API_KEY?: string;
}

/**
 * Loads environment variables from .env.local file
 * @param workspaceFolder - The workspace folder path
 * @returns An object containing loaded environment variables
 */
export const loadEnvironmentVars = (workspaceFolder?: string): EnvVars => {
  // Try to load from .env.local in workspace root if provided
  if (workspaceFolder) {
    const envLocalPath = path.join(workspaceFolder, '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const result = dotenv.config({ path: envLocalPath });
      if (result.error) {
        console.error('Error loading .env.local file:', result.error);
      } else {
        console.log('.env.local loaded successfully from workspace folder');
      }
    }
  }
  
  // If no OpenAI API key is found in process.env, try to get it from VSCode settings
  const config = vscode.workspace.getConfiguration('cursorcrawl');
  const apiKey = process.env.OPENAI_API_KEY || config.get('openaiApiKey');
  
  return {
    OPENAI_API_KEY: apiKey as string,
  };
};

/**
 * Creates an OpenAI API client using the API key
 * @param apiKey - The OpenAI API key
 * @returns An OpenAI API client instance
 */
export const createOpenAIClient = (apiKey?: string): OpenAI | undefined => {
  if (!apiKey) {
    console.error('OpenAI API key not found');
    return undefined;
  }
  
  return new OpenAI({
    apiKey,
  });
};

/**
 * Generates a docstring for a function or class using OpenAI
 * @param client - The OpenAI API client
 * @param codeSnippet - The code snippet to generate a docstring for
 * @param functionName - The name of the function or class
 * @returns The generated docstring
 */
export const generateDocstring = async (
  client: OpenAI,
  codeSnippet: string,
  functionName: string
): Promise<string> => {
  try {
    const prompt = `Generate a comprehensive JSDoc style docstring for the following TypeScript code. 
Focus on explaining what the function/class does, all parameters, return type, and possible errors.
Be concise but complete.

Code:
\`\`\`typescript
${codeSnippet}
\`\`\`

Return only the JSDoc comment block (with /** and */), nothing else.`;

    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates high-quality TypeScript docstrings.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const docstring = response.choices[0]?.message.content?.trim() || '';
    return docstring;
  } catch (error) {
    console.error(`Error generating docstring for ${functionName}:`, error);
    return `/**\n * ${functionName}\n */`;
  }
};

/**
 * Extracts code snippet for a node
 * @param sourceFile - The TypeScript source file
 * @param node - The TypeScript node
 * @returns The code snippet for the node
 */
const extractCodeSnippet = (sourceFile: ts.SourceFile, node: ts.Node): string => {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  return sourceFile.text.substring(start, end);
};

/**
 * Gets line and character for a node
 * @param sourceFile - The TypeScript source file
 * @param node - The TypeScript node
 * @returns The line and character information
 */
const getLineAndCharacter = (sourceFile: ts.SourceFile, node: ts.Node): { line: number; character: number } => {
  const position = node.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { line, character };
};

/**
 * Gets node type as a string
 * @param node - The TypeScript node
 * @returns The type of the node as a string
 */
const getNodeType = (node: ts.Node): DocstringInfo['type'] => {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || 
      ts.isArrowFunction(node) || ts.isMethodSignature(node)) {
    return 'function';
  } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return 'class';
  } else if (ts.isInterfaceDeclaration(node)) {
    return 'interface';
  } else if (ts.isTypeAliasDeclaration(node)) {
    return 'type';
  } else if (ts.isVariableDeclaration(node)) {
    return 'variable';
  } else {
    return 'other';
  }
};

/**
 * Gets the name of a node
 * @param node - The TypeScript node
 * @returns The name of the node or 'anonymous' if not found
 */
const getNodeName = (node: ts.Node): string => {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || 
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return node.name?.text || 'anonymous';
  } else if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) {
    return node.name.getText();
  } else if (ts.isVariableDeclaration(node)) {
    return node.name.getText();
  } else {
    return 'anonymous';
  }
};

/**
 * Extracts all documentable nodes from a TypeScript source file
 * @param sourceFile - The TypeScript source file
 * @param filePath - The path to the source file
 * @returns An array of docstring info objects
 */
const extractDocumentableNodes = (sourceFile: ts.SourceFile, filePath: string): DocstringInfo[] => {
  const nodes: DocstringInfo[] = [];
  
  function visit(node: ts.Node) {
    // Skip nodes that already have documentation comments
    const hasJSDoc = ts.getJSDocTags(node).length > 0;
    
    let shouldProcess = false;
    let nodeType: DocstringInfo['type'] = 'other';
    
    // Check for different node types
    if (ts.isFunctionDeclaration(node) || 
        ts.isClassDeclaration(node) || 
        ts.isInterfaceDeclaration(node) || 
        ts.isTypeAliasDeclaration(node) ||
        ts.isMethodDeclaration(node)) {
      shouldProcess = true;
      nodeType = getNodeType(node);
    } else if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      if (initializer && (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer))) {
        shouldProcess = true;
        nodeType = 'function';
      }
    }
    
    // Only collect nodes that are declarations and don't already have JSDoc
    if (shouldProcess && !hasJSDoc) {
      const name = getNodeName(node);
      const snippet = extractCodeSnippet(sourceFile, node);
      const location = getLineAndCharacter(sourceFile, node);
      
      nodes.push({
        name,
        filePath,
        docstring: '', // To be filled in later
        type: nodeType,
        snippet,
        location
      });
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return nodes;
};

/**
 * Generates docstrings for all applicable nodes in a file
 * @param filePath - The path to the file
 * @param client - The OpenAI API client
 * @returns An array of docstring info objects
 */
export const generateDocstringsForFile = async (
  filePath: string,
  client: OpenAI
): Promise<DocstringInfo[]> => {
  try {
    // Skip files that aren't TypeScript/JavaScript
    if (!ANALYZABLE_EXTENSIONS.includes(path.extname(filePath))) {
      return [];
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      content,
      ts.ScriptTarget.Latest,
      true
    );
    
    const nodes = extractDocumentableNodes(sourceFile, filePath);
    
    // Generate docstrings for each node
    const docstringPromises = nodes.map(async (node) => {
      const docstring = await generateDocstring(client, node.snippet, node.name);
      return {
        ...node,
        docstring
      };
    });
    
    return Promise.all(docstringPromises);
  } catch (error) {
    console.error(`Error generating docstrings for file ${filePath}:`, error);
    return [];
  }
};

/**
 * Generates a docstring index for all files in a project
 * @param rootPath - The root path of the project
 * @param ignoredPatterns - Patterns to ignore
 * @returns A map of file paths to docstring info arrays
 */
export const generateDocstringIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = []
): Promise<DocstringIndex> => {
  try {
    // Get environment variables
    const envVars = loadEnvironmentVars(rootPath);
    
    // Create OpenAI client
    const client = createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('Failed to create OpenAI client. API key not found.');
    }
    
    // Get project files
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Generate docstrings for each file
    const docstringIndex: DocstringIndex = {};
    
    // Process files in batches to avoid rate limiting
    const BATCH_SIZE = 5;
    for (let i = 0; i < projectFiles.length; i += BATCH_SIZE) {
      const batch = projectFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (filePath) => {
          const normalizedPath = normalizeFilePath(filePath, rootPath);
          const docstrings = await generateDocstringsForFile(filePath, client);
          return { path: normalizedPath, docstrings };
        })
      );
      
      // Add results to index
      batchResults.forEach(({ path, docstrings }) => {
        if (docstrings.length > 0) {
          docstringIndex[path] = docstrings;
        }
      });
      
      // If there are more files to process, wait a bit to avoid rate limiting
      if (i + BATCH_SIZE < projectFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Write index to file
    await writeDocstringIndex(rootPath, docstringIndex);
    
    return docstringIndex;
  } catch (error) {
    console.error('Error generating docstring index:', error);
    return {};
  }
};

/**
 * Gets all project files
 * Helper function similar to the one in smart-symbol-index.ts
 * @param rootPath - The root path of the project
 * @param ignoredPatterns - Patterns to ignore
 * @returns An array of file paths
 */
const getProjectFiles = async (
  rootPath: string,
  ignoredPatterns: string[] = []
): Promise<string[]> => {
  const isIgnored = (filePath: string): boolean => {
    const relativePath = path.relative(rootPath, filePath);
    
    // Check if it's in always ignored directories
    if (ALWAYS_IGNORED_DIRS.some(dir => relativePath.startsWith(dir + path.sep) || relativePath === dir)) {
      return true;
    }
    
    // Check against ignored patterns
    return ignoredPatterns.some(pattern => {
      if (pattern.endsWith('/')) {
        // Directory pattern
        return relativePath.startsWith(pattern) || relativePath.startsWith(pattern.slice(0, -1) + path.sep);
      } else {
        // File pattern
        return relativePath === pattern || relativePath.endsWith(path.sep + pattern);
      }
    });
  };
  
  const traverseDirectory = async (currentPath: string): Promise<string[]> => {
    if (isIgnored(currentPath)) {
      return [];
    }
    
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const files: string[] = [];
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...await traverseDirectory(fullPath));
      } else if (entry.isFile() && ANALYZABLE_EXTENSIONS.includes(path.extname(fullPath))) {
        files.push(fullPath);
      }
    }
    
    return files;
  };
  
  const files = await traverseDirectory(rootPath);
  
  // Safety check - limit number of files to process
  if (files.length > MAX_FILES_TO_PROCESS) {
    console.warn(`Project contains ${files.length} files, which exceeds the limit of ${MAX_FILES_TO_PROCESS}. Only processing the first ${MAX_FILES_TO_PROCESS} files.`);
    return files.slice(0, MAX_FILES_TO_PROCESS);
  }
  
  return files;
};

/**
 * Normalizes a file path relative to the root path
 * @param filePath - The file path to normalize
 * @param rootPath - The root path
 * @returns The normalized file path
 */
const normalizeFilePath = (filePath: string, rootPath: string): string => {
  return path.relative(rootPath, filePath).split(path.sep).join('/');
};

/**
 * Writes the docstring index to a file
 * @param rootPath - The root path of the project
 * @param docstringIndex - The docstring index to write
 */
const writeDocstringIndex = async (
  rootPath: string,
  docstringIndex: DocstringIndex
): Promise<void> => {
  try {
    const outputDir = path.join(rootPath, '.cursortest');
    const outputFilePath = path.join(outputDir, 'docstring-index.json');
    
    await fs.ensureDir(outputDir);
    await fs.writeJSON(outputFilePath, docstringIndex, { spaces: 2 });
    
    console.log(`Docstring index written to ${outputFilePath}`);
  } catch (error) {
    console.error('Error writing docstring index:', error);
  }
}; 