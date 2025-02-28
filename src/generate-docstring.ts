import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import OpenAI from 'openai';

// Import types and utilities
import { SymbolIndex } from './types/symbol-index';
import {
  isAnalyzableFile,
  normalizeFilePath,
  getProjectFiles
} from './utils/file-system';
import {
  writeCursorTestFile,
  ensureCursorTestDir
} from './utils/workspace';
import {
  loadEnvironmentVars,
  createOpenAIClient,
  generateDocstringsStructured,
} from './utils/openai';

// Output directory and file for the symbol index
const OUTPUT_DIR = '.cursortest';
const OUTPUT_FILE = 'symbol-index.json';

/**
 * Generates docstrings for symbols in the index
 * @param symbolIndex - The symbol index to generate docstrings for
 * @param client - The OpenAI client to use for docstring generation
 * @param projectFiles - List of project files
 * @param rootPath - Path to the project root
 * @param progress - Optional progress reporter
 * @returns Promise that resolves when docstrings are generated
 */
export const generateDocstrings = async (
  symbolIndex: SymbolIndex,
  client: OpenAI,
  projectFiles: string[],
  rootPath: string,
  progress?: { report: (info: { message: string }) => void }
): Promise<void> => {
  try {
    // Process files in batches to avoid rate limiting
    const BATCH_SIZE = 5;
    let fileCount = 0;
    
    for (const filePath in symbolIndex) {
      if (fileCount % BATCH_SIZE === 0) {
        const currentBatch = Math.floor(fileCount / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(Object.keys(symbolIndex).length / BATCH_SIZE);
        progress?.report({ 
          message: `Generating docstrings (batch ${currentBatch}/${totalBatches})...`
        });
      }
      
      // Find the full file path
      const fullFilePath = projectFiles.find(p => normalizeFilePath(p, rootPath) === filePath);
      if (!fullFilePath) {
        continue;
      }
      
      // Read the file content
      const fileContent = await fs.readFile(fullFilePath, 'utf8');
      
      // Get symbols for this file
      const fileSymbols = symbolIndex[filePath];
      
      // Extract node information to pass to the model
      const nodeInfos = fileSymbols.map(symbol => ({
        name: symbol.name,
        // Map 'method' and 'enum' to 'function' and 'other' for compatibility
        type: (symbol.type === 'method' ? 'function' : 
               symbol.type === 'enum' ? 'other' : 
               symbol.type) as 'function' | 'class' | 'interface' | 'type' | 'variable' | 'other',
        location: symbol.location,
        snippet: symbol.snippet,
      }));
      
      // Generate docstrings using the structured approach
      try {
        const output = await generateDocstringsStructured(client, fileContent, nodeInfos);
        
        // Update the symbol index with generated docstrings
        for (let i = 0; i < fileSymbols.length; i++) {
          const symbol = fileSymbols[i];
          const generatedDocstring = output.docstrings.find(
            ds => ds.name === symbol.name && ds.type === symbol.type
          );
          
          if (generatedDocstring) {
            symbol.docstring = generatedDocstring.docstring;
            
            // Note: Parameter and return type descriptions are now fully contained in the docstring
            // No need to separately extract and store them as parameters and returnType properties
          }
        }
      } catch (error) {
        console.error(`Error generating docstrings for ${filePath}:`, error);
      }
      
      fileCount++;
      
      // If there are more files to process, wait a bit to avoid rate limiting
      if (fileCount % BATCH_SIZE === 0 && fileCount < Object.keys(symbolIndex).length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    console.error('Error generating docstrings:', error);
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
    // Create the output directory if it doesn't exist
    await ensureCursorTestDir(rootPath);
    
    // Write the index to file
    await writeCursorTestFile(rootPath, OUTPUT_FILE, symbolIndex);
    
    console.log(`Symbol index written to ${path.join(rootPath, OUTPUT_DIR, OUTPUT_FILE)}`);
  } catch (error) {
    console.error('Error writing symbol index:', error);
    throw error;
  }
};

/**
 * Generates docstrings for an existing symbol index
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 */
export const generateDocstringIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>
): Promise<void> => {
  try {
    // Ensure .cursortest directory exists
    await ensureCursorTestDir(rootPath);
    
    // Check if symbol-index.json exists
    const symbolIndexPath = path.join(rootPath, '.cursortest', 'symbol-index.json');
    if (!await fs.pathExists(symbolIndexPath)) {
      throw new Error('Symbol index not found. Please build the symbol index first.');
    }
    
    // Load existing symbol index
    const symbolIndexContent = await fs.readFile(symbolIndexPath, 'utf8');
    const symbolIndex: SymbolIndex = JSON.parse(symbolIndexContent);
    
    // Get environment variables for OpenAI
    const envVars = loadEnvironmentVars(rootPath);
    
    // Create OpenAI client for docstring generation
    const client = createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    progress?.report({ message: 'Generating docstrings...' });
    
    // Get project files
    const projectFiles = await getProjectFiles(rootPath, ignoredPatterns);
    
    // Generate docstrings
    await generateDocstrings(symbolIndex, client, projectFiles, rootPath, progress);
    
    // Write updated symbol index to file
    progress?.report({ message: 'Writing updated symbol index to file...' });
    await writeSymbolIndex(rootPath, symbolIndex);
    
    progress?.report({ message: 'Docstring generation complete.' });
  } catch (error) {
    console.error('Error generating docstrings:', error);
    throw error;
  }
}; 