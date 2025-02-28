import * as fs from 'fs-extra';
import * as path from 'path';
import OpenAI from 'openai';
import * as ts from 'typescript';
import { DocstringInfo, DocstringIndex } from './types/docstring-index';
import { 
  normalizeFilePath,
  isAnalyzableFile,
  getProjectFiles 
} from './utils/file-system';
import { 
  loadEnvironmentVars, 
  createOpenAIClient, 
  generateDocstringsStructured,
} from './utils/openai';
import { 
  extractCodeSnippet, 
  getLineAndCharacter 
} from './utils/ts-analyzer';
import { 
  writeCursorTestFile, 
} from './utils/workspace';

// Load environment variables from .env.local
interface EnvVars {
  OPENAI_API_KEY?: string;
}

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
 * @param rootPath - The root path of the project for normalizing file paths
 * @returns An array of docstring info objects
 */
const extractDocumentableNodes = (
  sourceFile: ts.SourceFile, 
  filePath: string,
  rootPath: string
): DocstringInfo[] => {
  const nodes: DocstringInfo[] = [];
  
  // Normalize the file path relative to the project root
  const normalizedPath = normalizeFilePath(filePath, rootPath);
  
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
        filePath: normalizedPath,
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
 * Generates docstrings for a file using OpenAI structured output
 * @param client - The OpenAI API client
 * @param filePath - Path to the file
 * @param fileContent - Content of the file
 * @param docNodes - List of documentable nodes found in the file
 * @returns Array of docstring info objects
 */
export const generateDocstringsForFileContent = async (
  client: OpenAI,
  filePath: string,
  fileContent: string,
  docNodes: DocstringInfo[]
): Promise<DocstringInfo[]> => {
  try {
    // Extract node information to pass to the model
    const nodeInfos = docNodes.map(node => ({
      name: node.name,
      type: node.type,
      location: node.location,
      snippet: node.snippet,
    }));
    
    // Generate docstrings using the structured approach
    const output = await generateDocstringsStructured(client, fileContent, nodeInfos);
    
    // Map the output back to our DocstringInfo format
    return docNodes.map(node => {
      const generatedDocstring = output.docstrings.find(
        ds => ds.name === node.name && ds.type === node.type
      );
      
      return {
        ...node,
        docstring: generatedDocstring?.docstring || `/**\n * ${node.name}\n */`
      };
    });
  } catch (error) {
    console.error(`Error generating docstrings for file ${filePath}:`, error);
    // Return default placeholder docstrings if API call fails
    return docNodes.map(node => ({
      ...node,
      docstring: `/**\n * ${node.name}\n */`
    }));
  }
};

/**
 * Generates docstrings for all applicable nodes in a file
 * @param filePath - The path to the file
 * @param client - The OpenAI API client
 * @param rootPath - The root path of the project
 * @returns An array of docstring info objects
 */
export const generateDocstringsForFile = async (
  filePath: string,
  client: OpenAI,
  rootPath: string
): Promise<DocstringInfo[]> => {
  try {
    // Skip files that aren't TypeScript/JavaScript
    if (!isAnalyzableFile(filePath)) {
      return [];
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      content,
      ts.ScriptTarget.Latest,
      true
    );
    
    const nodes = extractDocumentableNodes(sourceFile, filePath, rootPath);
    
    // If no nodes need docstrings, return empty array
    if (nodes.length === 0) {
      return [];
    }
    
    // Generate docstrings for all nodes in the file at once
    return await generateDocstringsForFileContent(client, filePath, content, nodes);
  } catch (error) {
    console.error(`Error generating docstrings for file ${filePath}:`, error);
    return [];
  }
};

/**
 * Generates a docstring index for all files in a project
 * @param rootPath - The root path of the project
 * @param ignoredPatterns - Patterns to ignore
 * @param progress - Optional progress reporter to show current status
 * @returns A map of file paths to docstring info arrays
 */
export const generateDocstringIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: { report: (info: { message: string }) => void }
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
    progress?.report({ message: 'Analyzing project structure...' });
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Initialize docstring index
    const docstringIndex: DocstringIndex = {};
    
    // Load existing docstring index if it exists
    try {
      const cursorTestDir = path.join(rootPath, '.cursortest');
      const indexPath = path.join(cursorTestDir, 'docstring-index.json');
      if (await fs.pathExists(indexPath)) {
        const existingIndex = await fs.readJson(indexPath);
        Object.assign(docstringIndex, existingIndex);
        progress?.report({ message: 'Loaded existing docstring index' });
      }
    } catch (error) {
      console.error('Error loading existing docstring index:', error);
      // Continue with empty index if there's an error
    }
    
    // Process files in batches to avoid rate limiting
    const BATCH_SIZE = 5;
    for (let i = 0; i < projectFiles.length; i += BATCH_SIZE) {
      const batch = projectFiles.slice(i, i + BATCH_SIZE);
      
      // Update progress to show which batch we're processing
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(projectFiles.length / BATCH_SIZE);
      progress?.report({ 
        message: `Processing files (batch ${currentBatch}/${totalBatches})...`
      });
      
      // Process files one by one
      for (const filePath of batch) {
        const filename = path.basename(filePath);
        // Update progress message for each file being processed
        progress?.report({ 
          message: `Generating docstrings for ${filename}...` 
        });
        
        const normalizedPath = normalizeFilePath(filePath, rootPath);
        const docstrings = await generateDocstringsForFile(filePath, client, rootPath);
        
        // Only add to index and write if there are docstrings
        if (docstrings.length > 0) {
          docstringIndex[normalizedPath] = docstrings;
          
          // Write the updated index to file after each file is processed
          progress?.report({ message: `Updating docstring index with ${filename}...` });
          await writeDocstringIndex(rootPath, docstringIndex);
        }
      }
      
      // If there are more files to process, wait a bit to avoid rate limiting
      if (i + BATCH_SIZE < projectFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    progress?.report({ message: 'Docstring index generation complete' });
    return docstringIndex;
  } catch (error) {
    console.error('Error generating docstring index:', error);
    return {};
  }
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
    await writeCursorTestFile(rootPath, 'docstring-index.json', docstringIndex);
    console.log('Docstring index written successfully');
  } catch (error) {
    console.error('Error writing docstring index:', error);
  }
}; 