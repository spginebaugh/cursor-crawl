import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import OpenAI from 'openai';

// Import types and services
import { SymbolIndex } from '@/shared/types/symbol-index';
import { FileSystemService } from '@/shared/services/file-system-service';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { OpenAiService } from '@/shared/services/openai-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { DocstringGenerationService } from './docstring-generation-service';
import { ProgressReporter, adaptVSCodeProgress } from '@/shared/types/progress-reporter';
import { FileIoService } from './file-io-service';

// Output directory and file for the symbol index
const OUTPUT_DIR = '.cursortest';
const OUTPUT_FILE = 'symbol-index.json';

/**
 * Enum for docstring generation modes
 */
export enum DocstringGenerationMode {
  /** Generate docstrings for all symbols, regardless of existing docstrings */
  GENERATE_ALL = 'generate_all',
  /** Only generate docstrings for symbols with empty or missing docstrings */
  GENERATE_MISSING = 'generate_missing'
}

/**
 * Interface for docstring generation parameters
 */
interface DocstringGenerationParams {
  symbolIndex: SymbolIndex;
  client: OpenAI;
  projectFiles: string[];
  rootPath: string;
  progress?: ProgressReporter;
  mode: DocstringGenerationMode;
}

/**
 * Generates docstrings for symbols in the index
 * @param params - Parameters for docstring generation
 * @returns Promise that resolves when docstrings are generated
 */
export const generateDocstrings = async ({
  symbolIndex,
  client,
  projectFiles,
  rootPath,
  progress,
  mode
}: DocstringGenerationParams): Promise<void> => {
  try {
    // Get total number of files to process for progress reporting
    const totalFiles = Object.keys(symbolIndex).length;
    let fileCount = 0;
    let processedSymbolCount = 0;
    let skippedSymbolCount = 0;
    let consecutiveErrorCount = 0;
    const MAX_CONSECUTIVE_ERRORS = 3; // Maximum number of consecutive errors before cancelling
    
    const skipExisting = mode === DocstringGenerationMode.GENERATE_MISSING;
    
    // Process files one by one
    for (const filePath in symbolIndex) {
      // Check for cancellation before processing each file
      if (progress?.isCancelled?.()) {
        progress?.report({ message: 'Docstring generation cancelled.' });
        return;
      }
      
      fileCount++;
      
      // Get symbols for this file
      const fileSymbols = symbolIndex[filePath];
      
      // Filter symbols based on the generation mode
      const getSymbolsToProcess = () => {
        if (mode === DocstringGenerationMode.GENERATE_MISSING) {
          return fileSymbols.filter(symbol => DocstringGenerationService.isEmptyDocstring(symbol.docstring));
        }
        return fileSymbols;
      };
      
      const symbolsToProcess = getSymbolsToProcess();
      
      // Log some diagnostics in debug mode
      console.log(`File: ${filePath}, Total symbols: ${fileSymbols.length}, Symbols to process: ${symbolsToProcess.length}`);
      
      // Skip file if no symbols need processing
      if (symbolsToProcess.length === 0) {
        if (skipExisting) {
          skippedSymbolCount += fileSymbols.length;
        }
        continue;
      }
      
      // Update progress for each file
      const getProgressMessage = () => {
        if (mode === DocstringGenerationMode.GENERATE_MISSING) {
          return `Generating missing docstrings for file ${fileCount}/${totalFiles}: ${filePath} (${symbolsToProcess.length} symbols)`;
        }
        return `Generating docstrings for file ${fileCount}/${totalFiles}: ${filePath}`;
      };
      
      progress?.report({ message: getProgressMessage() });
      
      // Find the full file path
      const fullFilePath = projectFiles.find(p => FileSystemService.normalizeFilePath(p, rootPath) === filePath);
      if (!fullFilePath) {
        continue;
      }
      
      // Read the file content
      const fileContent = await FileIoService.readFileContent(fullFilePath);
      
      try {
        // Generate docstrings using the dedicated service
        const updatedSymbols = await DocstringGenerationService.generateDocstringsForSymbols({
          fileContent,
          symbols: symbolsToProcess,
          client
        });
        
        // Reset consecutive error count on success
        consecutiveErrorCount = 0;
        
        // Check for cancellation after processing symbols
        if (progress?.isCancelled?.()) {
          progress?.report({ message: 'Docstring generation cancelled.' });
          return;
        }
        
        // Update the symbol index with generated docstrings
        for (const updatedSymbol of updatedSymbols) {
          // Find the actual symbol in the fileSymbols array
          const actualSymbolIndex = fileSymbols.findIndex(
            s => s.name === updatedSymbol.name && s.type === updatedSymbol.type
          );
          
          if (actualSymbolIndex !== -1) {
            fileSymbols[actualSymbolIndex].docstring = updatedSymbol.docstring;
            processedSymbolCount++;
            console.log(`Generated docstring for ${updatedSymbol.name}`);
          }
        }
        
        // Write the updated symbol index to file after each file is processed
        await SymbolIndexService.writeSymbolIndex(rootPath, symbolIndex);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error generating docstrings for ${filePath}:`, error);
        
        // Check if this is an error that persisted after retries
        if (error instanceof Error) {
          // Increment consecutive error counter
          consecutiveErrorCount++;
          
          // Check properties added by our enhanced error handling
          const shouldCancel = (error as any).shouldCancelGeneration === true || 
                              (error as any).isServerError === true ||
                              consecutiveErrorCount >= MAX_CONSECUTIVE_ERRORS;
          
          if (shouldCancel) {
            // Show cancellation message
            const errorMessage = 'Docstring generation cancelled due to persistent errors. Please try again later.';
            vscode.window.showErrorMessage(errorMessage);
            progress?.report({ message: errorMessage });
            
            // Save work done so far
            await SymbolIndexService.writeSymbolIndex(rootPath, symbolIndex);
            
            console.error('Docstring generation cancelled due to persistent errors:', error);
            return; // Exit the function
          }
        }
      }
    }
    
    // Check for cancellation before final reporting
    if (progress?.isCancelled?.()) {
      progress?.report({ message: 'Docstring generation cancelled.' });
      return;
    }
    
    const getCompletionMessage = () => {
      if (mode === DocstringGenerationMode.GENERATE_MISSING) {
        return `Docstring generation complete. Generated ${processedSymbolCount} docstrings, skipped ${skippedSymbolCount} existing docstrings.`;
      }
      return 'Docstring generation complete.';
    };
    
    progress?.report({ message: getCompletionMessage() });
  } catch (error) {
    console.error('Error generating docstrings:', error);
  }
};

/**
 * Unified function for generating docstrings with different modes
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 * @param token - Optional cancellation token
 * @param mode - Docstring generation mode
 */
export const generateDocstringsUnified = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>,
  token?: vscode.CancellationToken,
  mode: DocstringGenerationMode = DocstringGenerationMode.GENERATE_ALL
): Promise<void> => {
  try {
    // Ensure .cursortest directory exists
    await WorkspaceService.ensureCursorTestDir(rootPath);
    
    // Check if symbol-index.json exists and load it
    const symbolIndex = await SymbolIndexService.getSymbolIndexOrThrow(
      rootPath, 
      'Symbol index not found. Please build the symbol index first.'
    );
    
    // If generating only missing docstrings, validate and report stats
    if (mode === DocstringGenerationMode.GENERATE_MISSING) {
      const validation = DocstringGenerationService.validateSymbolIndex(symbolIndex);
      console.log('Symbol index validation:', validation);
      
      // Debug: Write a file with the symbols that need docstrings
      if (validation.emptyDocstrings > 0) {
        await FileIoService.writeSymbolsNeedingDocstrings(
          rootPath, 
          symbolIndex, 
          DocstringGenerationService.isEmptyDocstring
        );
      }
      
      progress?.report({ 
        message: `Preparing to generate missing docstrings (${validation.emptyDocstrings} symbols need processing)...` 
      });
    } else {
      progress?.report({ message: 'Preparing to generate all docstrings...' });
    }
    
    // Get environment variables for OpenAI
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    // Create OpenAI client for docstring generation
    const client = OpenAiService.createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    // Get project files
    const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
    
    // Generate docstrings using the unified function
    await generateDocstrings({
      symbolIndex,
      client,
      projectFiles,
      rootPath,
      progress: progress ? adaptVSCodeProgress(progress, token) : undefined,
      mode
    });
    
    const completionMessage = mode === DocstringGenerationMode.GENERATE_MISSING
      ? 'Missing docstring generation completed successfully.'
      : 'Docstring generation completed successfully.';
    
    progress?.report({ message: completionMessage });
  } catch (error) {
    console.error('Error generating docstrings:', error);
    
    // Handle different error types with user-friendly messages
    let errorMessage = 'An error occurred during docstring generation.';
    
    if (error instanceof Error) {
      if (error.message.includes('500')) {
        errorMessage = 'OpenAI server error (500). The service is temporarily unavailable. Please try again later.';
      } else if (error.message.includes('401') || error.message.includes('API key')) {
        errorMessage = 'Invalid or missing OpenAI API key. Please check your API key configuration.';
      } else if (error.message.includes('429') || error.message.includes('rate limit')) {
        errorMessage = 'OpenAI API rate limit exceeded. Please wait a few moments and try again.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request to OpenAI API timed out. Please check your network connection and try again.';
      } else if (error.message.includes('retry') || (error as any).shouldCancelGeneration === true) {
        errorMessage = 'Docstring generation failed after multiple retry attempts. Please try again later.';
      } else if ((error as any).isServerError === true) {
        errorMessage = 'OpenAI service is experiencing issues. Docstring generation has been cancelled. Please try again later.';
      } else {
        // For other errors, include the actual error message
        errorMessage = `Error generating docstrings: ${error.message}`;
      }
    }
    
    vscode.window.showErrorMessage(errorMessage);
    
    // Throw a standard error with the friendly message
    throw new Error(errorMessage);
  }
};

/**
 * Generates docstrings for an existing symbol index
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 * @param token - Optional cancellation token
 */
export const generateDocstringIndex = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>,
  token?: vscode.CancellationToken
): Promise<void> => {
  return generateDocstringsUnified(
    rootPath,
    ignoredPatterns,
    progress,
    token,
    DocstringGenerationMode.GENERATE_ALL
  );
};

/**
 * Resumes docstring generation for symbols that don't have docstrings
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore during file processing
 * @param progress - Optional progress reporter
 * @param token - Optional cancellation token
 */
export const resumeDocstringGeneration = async (
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>,
  token?: vscode.CancellationToken
): Promise<void> => {
  return generateDocstringsUnified(
    rootPath,
    ignoredPatterns,
    progress,
    token,
    DocstringGenerationMode.GENERATE_MISSING
  );
};
