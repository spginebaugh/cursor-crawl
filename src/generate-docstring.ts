import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import OpenAI from 'openai';

// Import types and services
import { SymbolIndex } from '@/types/symbol-index';
import { FileSystemService } from '@/services/file-system-service';
import { WorkspaceService } from '@/services/workspace-service';
import { OpenAiService } from '@/services/openai-service';
import { SymbolIndexService } from '@/services/symbol-index-service';

// Output directory and file for the symbol index
const OUTPUT_DIR = '.cursortest';
const OUTPUT_FILE = 'symbol-index.json';

/**
 * Determines if a docstring is empty or missing
 * @param docstring - The docstring to check
 * @returns True if the docstring is empty or missing
 */
const isEmptyDocstring = (docstring?: string): boolean => {
  // If docstring is undefined or null, it's empty
  if (!docstring) {
    return true;
  }
  
  const trimmed = docstring.trim();
  
  // Check for various empty docstring patterns
  if (trimmed === '' || 
      trimmed === '/**/' || 
      trimmed === '/** */' || 
      trimmed === '/**\n*/' ||
      trimmed === '/**\n */' ||
      trimmed === '/**\n\n*/' ||
      trimmed === '/** */') {
    return true;
  }
  
  // Check for simple placeholder docstrings that only contain the symbol name
  if (trimmed.startsWith('/**') && trimmed.endsWith('*/')) {
    const content = trimmed.substring(3, trimmed.length - 2).trim();
    // If the docstring just contains the name or is very short, consider it empty
    if (content === '' || content === '*' || content.length < 3) {
      return true;
    }
  }
  
  return false;
};

/**
 * Generates docstrings for symbols in the index
 * @param symbolIndex - The symbol index to generate docstrings for
 * @param client - The OpenAI client to use for docstring generation
 * @param projectFiles - List of project files
 * @param rootPath - Path to the project root
 * @param progress - Optional progress reporter
 * @param skipExisting - Whether to skip symbols that already have docstrings
 * @returns Promise that resolves when docstrings are generated
 */
export const generateDocstrings = async (
  symbolIndex: SymbolIndex,
  client: OpenAI,
  projectFiles: string[],
  rootPath: string,
  progress?: { report: (info: { message: string }) => void },
  skipExisting: boolean = false
): Promise<void> => {
  try {
    // Get total number of files to process for progress reporting
    const totalFiles = Object.keys(symbolIndex).length;
    let fileCount = 0;
    let processedSymbolCount = 0;
    let skippedSymbolCount = 0;
    
    // Process files one by one
    for (const filePath in symbolIndex) {
      fileCount++;
      
      // Get symbols for this file
      const fileSymbols = symbolIndex[filePath];
      
      // If skipExisting is true, filter out symbols that already have docstrings
      const symbolsToProcess = skipExisting
        ? fileSymbols.filter(symbol => isEmptyDocstring(symbol.docstring))
        : fileSymbols;
      
      // Log some diagnostics in debug mode
      console.log(`File: ${filePath}, Total symbols: ${fileSymbols.length}, Symbols to process: ${symbolsToProcess.length}`);
      
      // Skip file if all symbols already have docstrings
      if (skipExisting && symbolsToProcess.length === 0) {
        skippedSymbolCount += fileSymbols.length;
        continue;
      }
      
      // Update progress for each file
      const progressMessage = skipExisting
        ? `Generating missing docstrings for file ${fileCount}/${totalFiles}: ${filePath} (${symbolsToProcess.length} symbols)`
        : `Generating docstrings for file ${fileCount}/${totalFiles}: ${filePath}`;
      
      progress?.report({ message: progressMessage });
      
      // Find the full file path
      const fullFilePath = projectFiles.find(p => FileSystemService.normalizeFilePath(p, rootPath) === filePath);
      if (!fullFilePath) {
        continue;
      }
      
      // Read the file content
      const fileContent = await fs.readFile(fullFilePath, 'utf8');
      
      // Extract node information to pass to the model
      const nodeInfos = symbolsToProcess.map(symbol => ({
        name: symbol.name,
        // Map 'method' and 'enum' to 'function' and 'other' for compatibility
        type: (symbol.type === 'method' ? 'function' : 
               symbol.type === 'enum' ? 'other' : 
               symbol.type) as 'function' | 'class' | 'interface' | 'type' | 'variable' | 'other',
        location: symbol.location,
        snippet: symbol.snippet,
      }));
      
      if (nodeInfos.length > 0) {
        // Generate docstrings using the structured approach
        try {
          const output = await OpenAiService.generateDocstringsStructured(client, fileContent, nodeInfos);
          
          // Update the symbol index with generated docstrings
          for (const generatedDocstring of output.docstrings) {
            // Find matching symbol by name and type
            const matchingSymbol = symbolsToProcess.find(
              s => s.name === generatedDocstring.name && 
                   (s.type === generatedDocstring.type || 
                    (s.type === 'method' && generatedDocstring.type === 'function') ||
                    (s.type === 'enum' && generatedDocstring.type === 'other'))
            );
            
            if (matchingSymbol) {
              // Find the actual symbol in the fileSymbols array
              const actualSymbol = fileSymbols.find(s => s.name === matchingSymbol.name && s.type === matchingSymbol.type);
              if (actualSymbol) {
                actualSymbol.docstring = generatedDocstring.docstring;
                processedSymbolCount++;
                console.log(`Generated docstring for ${actualSymbol.name}`);
              }
            }
          }
          
          // Write the updated symbol index to file after each file is processed
          await writeSymbolIndex(rootPath, symbolIndex);
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error generating docstrings for ${filePath}:`, error);
        }
      } else {
        if (skipExisting) {
          skippedSymbolCount += fileSymbols.length;
        }
      }
    }
    
    const completionMessage = skipExisting
      ? `Docstring generation complete. Generated ${processedSymbolCount} docstrings, skipped ${skippedSymbolCount} existing docstrings.`
      : 'Docstring generation complete.';
    
    progress?.report({ message: completionMessage });
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
    // Write the index to file using the service
    await SymbolIndexService.writeSymbolIndex(rootPath, symbolIndex);
    
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
    await WorkspaceService.ensureCursorTestDir(rootPath);
    
    // Check if symbol-index.json exists
    const symbolIndexPath = path.join(rootPath, '.cursortest', 'symbol-index.json');
    if (!await fs.pathExists(symbolIndexPath)) {
      throw new Error('Symbol index not found. Please build the symbol index first.');
    }
    
    // Load existing symbol index
    const symbolIndex = await SymbolIndexService.getSymbolIndexOrThrow(rootPath);
    
    // Get environment variables for OpenAI
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    // Create OpenAI client for docstring generation
    const client = OpenAiService.createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    progress?.report({ message: 'Generating docstrings...' });
    
    // Get project files
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
    // Generate docstrings
    await generateDocstrings(symbolIndex, client, projectFiles, rootPath, progress, false);
    
    // Write updated symbol index to file
    progress?.report({ message: 'Writing updated symbol index to file...' });
    await writeSymbolIndex(rootPath, symbolIndex);
    
    progress?.report({ message: 'Docstring generation complete.' });
  } catch (error) {
    console.error('Error generating docstrings:', error);
    throw error;
  }
};

/**
 * Resumes docstring generation for symbols that don't have docstrings
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 */
export const resumeDocstringGeneration = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>
): Promise<void> => {
  try {
    // Ensure .cursortest directory exists
    await WorkspaceService.ensureCursorTestDir(rootPath);
    
    // Check if symbol-index.json exists and load it
    const symbolIndex = await SymbolIndexService.getSymbolIndexOrThrow(
      rootPath, 
      'Symbol index not found. Please build the symbol index first.'
    );
    
    // Validate the index to check for docstring presence
    const validation = validateSymbolIndex(symbolIndex);
    console.log('Symbol index validation:', validation);
    
    // Debug: Write a file with the symbols that need docstrings
    if (validation.emptyDocstrings > 0) {
      await writeSymbolsNeedingDocstrings(rootPath, symbolIndex);
    }
    
    // Get environment variables for OpenAI
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    // Create OpenAI client for docstring generation
    const client = OpenAiService.createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    progress?.report({ 
      message: `Resuming docstring generation for empty docstrings (${validation.emptyDocstrings} symbols need processing)...` 
    });
    
    // Get project files
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
    // Generate docstrings, but skip existing ones
    await generateDocstrings(symbolIndex, client, projectFiles, rootPath, progress, true);
    
    // Write updated symbol index to file
    progress?.report({ message: 'Writing updated symbol index to file...' });
    await writeSymbolIndex(rootPath, symbolIndex);
    
    progress?.report({ message: 'Docstring generation resumed and completed.' });
  } catch (error) {
    console.error('Error resuming docstrings generation:', error);
    throw error;
  }
};

/**
 * Writes a debug file with the list of symbols that need docstrings
 * @param rootPath - Project root path
 * @param symbolIndex - Symbol index to analyze
 */
const writeSymbolsNeedingDocstrings = async (
  rootPath: string,
  symbolIndex: SymbolIndex
): Promise<void> => {
  try {
    const symbolsNeedingDocstrings: Array<{
      filePath: string;
      name: string;
      type: string;
      docstring: string | undefined;
    }> = [];
    
    // Gather all symbols needing docstrings
    for (const filePath in symbolIndex) {
      const fileSymbols = symbolIndex[filePath];
      
      for (const symbol of fileSymbols) {
        if (isEmptyDocstring(symbol.docstring)) {
          symbolsNeedingDocstrings.push({
            filePath,
            name: symbol.name,
            type: symbol.type,
            docstring: symbol.docstring
          });
        }
      }
    }
    
    // Write to a debug file
    const debugFilePath = path.join(rootPath, '.cursortest', 'symbols-needing-docstrings.json');
    await fs.writeFile(debugFilePath, JSON.stringify(symbolsNeedingDocstrings, null, 2), 'utf8');
    
    console.log(`Wrote list of ${symbolsNeedingDocstrings.length} symbols needing docstrings to ${debugFilePath}`);
  } catch (error) {
    console.error('Error writing debug file:', error);
  }
};

/**
 * Validates the symbol index, counting filled and empty docstrings
 * @param symbolIndex - The symbol index to validate
 * @returns Validation results with counts
 */
const validateSymbolIndex = (symbolIndex: SymbolIndex): { totalSymbols: number; filledDocstrings: number; emptyDocstrings: number } => {
  let totalSymbols = 0;
  let filledDocstrings = 0;
  let emptyDocstrings = 0;
  
  // Process each file in the index
  for (const filePath in symbolIndex) {
    const fileSymbols = symbolIndex[filePath];
    totalSymbols += fileSymbols.length;
    
    // Check each symbol
    for (const symbol of fileSymbols) {
      if (isEmptyDocstring(symbol.docstring)) {
        emptyDocstrings++;
        // Log a few examples of empty docstrings
        if (emptyDocstrings <= 5) {
          console.log(`Empty docstring example ${emptyDocstrings}:`, {
            name: symbol.name,
            type: symbol.type,
            docstring: symbol.docstring
          });
        }
      } else {
        filledDocstrings++;
        // Log a few examples of filled docstrings
        if (filledDocstrings <= 5) {
          console.log(`Filled docstring example ${filledDocstrings}:`, {
            name: symbol.name,
            type: symbol.type,
            docstring: symbol.docstring ? symbol.docstring.substring(0, 50) + '...' : undefined
          });
        }
      }
    }
  }
  
  return {
    totalSymbols,
    filledDocstrings,
    emptyDocstrings
  };
}; 