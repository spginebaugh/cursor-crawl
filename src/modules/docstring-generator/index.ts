import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';
import OpenAI from 'openai';
import { DocstringInfo, DocstringIndex } from '../../types/docstring-index';
import { 
  ANALYZABLE_EXTENSIONS,
  normalizeFilePath,
  isAnalyzableFile,
  getProjectFiles 
} from '../../utils/file-system';
import { 
  loadEnvironmentVars, 
  createOpenAIClient, 
  generateDocstring 
} from '../../utils/openai';
import { 
  extractCodeSnippet, 
  getLineAndCharacter 
} from '../../utils/ts-analyzer';
import { 
  writeCursorTestFile 
} from '../../utils/workspace';

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