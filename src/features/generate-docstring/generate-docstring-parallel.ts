import * as vscode from 'vscode';
import OpenAI from 'openai';

// Import types and services
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { FileSystemService } from '@/shared/services/file-system-service';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { OpenAiService } from '@/shared/services/openai-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { DocstringGenerationService } from './docstring-generation-service';
import { ProgressReporter, adaptVSCodeProgress } from '@/shared/types/progress-reporter';
import { FileIoService } from './file-io-service';
import { DocstringGenerationMode } from './generate-docstring';

/**
 * Interface for file batch processing parameters
 */
interface FileBatchParams {
  filePath: string;
  symbols: SymbolIndexEntry[];
  fullFilePath: string;
  fileContent: string;
  client: OpenAI;
  progress?: ProgressReporter;
  mode: DocstringGenerationMode;
  totalFiles: number;
  fileIndex: number;
}

/**
 * Processes a single file to generate docstrings
 * @param params - Parameters for processing a file
 * @returns Updated symbols for the file
 */
const processFileDocstrings = async ({
  filePath,
  symbols,
  fullFilePath,
  fileContent,
  client,
  progress,
  mode,
  totalFiles,
  fileIndex
}: FileBatchParams): Promise<SymbolIndexEntry[]> => {
  try {
    const skipExisting = mode === DocstringGenerationMode.GENERATE_MISSING;
    
    // Filter symbols based on the generation mode
    const symbolsToProcess = skipExisting
      ? symbols.filter(symbol => DocstringGenerationService.isEmptyDocstring(symbol.docstring))
      : symbols;
    
    // Skip file if no symbols need processing
    if (symbolsToProcess.length === 0) {
      return symbols;
    }
    
    // Update progress for this file
    const progressMessage = skipExisting
      ? `[${fileIndex}/${totalFiles}] Generating missing docstrings for: ${filePath} (${symbolsToProcess.length} symbols)`
      : `[${fileIndex}/${totalFiles}] Generating docstrings for: ${filePath}`;
    
    progress?.report({ message: progressMessage });
    
    // Generate docstrings using the dedicated service
    const updatedSymbols = await DocstringGenerationService.generateDocstringsForSymbols({
      fileContent,
      symbols: symbolsToProcess,
      client
    });
    
    // Check for cancellation after processing symbols
    if (progress?.isCancelled?.()) {
      progress?.report({ message: 'Docstring generation cancelled.' });
      return symbols;
    }
    
    // Return the merged results (updated symbols + any existing symbols that weren't processed)
    return symbols.map(originalSymbol => {
      const updatedSymbol = updatedSymbols.find(
        s => s.name === originalSymbol.name && s.type === originalSymbol.type
      );
      
      return updatedSymbol || originalSymbol;
    });
  } catch (error) {
    console.error(`Error processing docstrings for file ${filePath}:`, error);
    
    // If this is a critical error that should stop processing, rethrow it
    if (error instanceof Error && 
       ((error as any).shouldCancelGeneration === true || 
        (error as any).isServerError === true)) {
      throw error;
    }
    
    // Otherwise, return the original symbols (skip this file but continue with others)
    return symbols;
  }
};

/**
 * Processes a batch of files in parallel
 * @param fileBatch - Array of files to process
 * @param symbolIndex - The symbol index
 * @param projectFiles - All project files
 * @param rootPath - Root path of the project
 * @param client - OpenAI client
 * @param progress - Progress reporter
 * @param token - Cancellation token
 * @param mode - Docstring generation mode
 * @param totalFiles - Total number of files
 * @param startIndex - Starting index for this batch
 * @returns Updated symbol counts
 */
const processFileBatch = async (
  fileBatch: string[],
  symbolIndex: SymbolIndex,
  projectFiles: string[],
  rootPath: string,
  client: OpenAI,
  progress?: ProgressReporter,
  token?: vscode.CancellationToken,
  mode: DocstringGenerationMode = DocstringGenerationMode.GENERATE_ALL,
  totalFiles: number = 0,
  startIndex: number = 0
): Promise<{ processedCount: number; updatedIndex: SymbolIndex }> => {
  let processedCount = 0;
  
  // Process each file in the batch concurrently
  const filePromises = fileBatch.map(async (filePath, batchIndex) => {
    // Check for cancellation
    if (token?.isCancellationRequested) {
      return { filePath, processedCount: 0, updatedSymbols: symbolIndex[filePath] };
    }
    
    const fileIndex = startIndex + batchIndex + 1;
    const fileSymbols = symbolIndex[filePath];
    
    // Find the full file path
    const fullFilePath = projectFiles.find(p => FileSystemService.normalizeFilePath(p, rootPath) === filePath);
    if (!fullFilePath) {
      return { filePath, processedCount: 0, updatedSymbols: fileSymbols };
    }
    
    // Read the file content
    const fileContent = await FileIoService.readFileContent(fullFilePath);
    
    // Process the file to generate docstrings
    const updatedSymbols = await processFileDocstrings({
      filePath,
      symbols: fileSymbols,
      fullFilePath,
      fileContent,
      client,
      progress,
      mode,
      totalFiles,
      fileIndex
    });
    
    // Count processed symbols for statistics
    const fileProcessedCount = updatedSymbols.filter((symbol, index) => 
      !DocstringGenerationService.isEmptyDocstring(symbol.docstring) && 
      (mode === DocstringGenerationMode.GENERATE_ALL || 
       DocstringGenerationService.isEmptyDocstring(fileSymbols[index].docstring))
    ).length;
    
    return { filePath, processedCount: fileProcessedCount, updatedSymbols };
  });
  
  // Wait for all files in the batch to complete
  const results = await Promise.all(filePromises);
  
  // Update the symbol index and count processed symbols
  for (const result of results) {
    if (token?.isCancellationRequested) {
      break;
    }
    symbolIndex[result.filePath] = result.updatedSymbols;
    processedCount += result.processedCount;
  }
  
  return { processedCount, updatedIndex: symbolIndex };
};

/**
 * Processes all files in batches to manage concurrency
 * @param files - Array of files to process
 * @param batchSize - Maximum number of files to process concurrently
 * @param symbolIndex - The symbol index
 * @param projectFiles - All project files
 * @param rootPath - Root path of the project
 * @param client - OpenAI client
 * @param progress - Progress reporter
 * @param token - Cancellation token
 * @param mode - Docstring generation mode
 * @returns Total processed symbols count
 */
const processFilesInBatches = async (
  files: string[],
  batchSize: number,
  symbolIndex: SymbolIndex,
  projectFiles: string[],
  rootPath: string,
  client: OpenAI,
  progress?: ProgressReporter,
  token?: vscode.CancellationToken,
  mode: DocstringGenerationMode = DocstringGenerationMode.GENERATE_ALL
): Promise<{ processedCount: number; updatedIndex: SymbolIndex }> => {
  let totalProcessedCount = 0;
  const totalFiles = files.length;
  let updatedIndex = { ...symbolIndex };
  
  // Process files in batches
  for (let i = 0; i < files.length; i += batchSize) {
    // Check for cancellation
    if (token?.isCancellationRequested) {
      break;
    }
    
    // Get the current batch of files
    const batch = files.slice(i, i + batchSize);
    
    // Process this batch
    const { processedCount, updatedIndex: newIndex } = await processFileBatch(
      batch,
      updatedIndex,
      projectFiles,
      rootPath,
      client,
      progress,
      token,
      mode,
      totalFiles,
      i
    );
    
    // Update counts and index
    totalProcessedCount += processedCount;
    updatedIndex = newIndex;
    
    // Save progress periodically
    if ((i + batchSize) % (batchSize * 2) === 0 || (i + batchSize) >= files.length) {
      progress?.report({ message: `Saving progress... (${i + batch.length}/${totalFiles} files processed)` });
      await SymbolIndexService.writeSymbolIndex(rootPath, updatedIndex);
    }
  }
  
  return { processedCount: totalProcessedCount, updatedIndex };
};

/**
 * Generates docstrings in parallel for symbols in the index
 * @param rootPath - Path to the project root
 * @param ignoredPatterns - Patterns to ignore
 * @param progress - Optional progress reporter
 * @param token - Optional cancellation token
 * @param concurrency - Maximum number of files to process concurrently
 * @param mode - Docstring generation mode (defaults to GENERATE_ALL)
 * @returns Whether the operation was successful
 */
export async function generateDocstringsParallel(
  rootPath: string,
  ignoredPatterns: string[] = [],
  progress?: vscode.Progress<{ message?: string }>,
  token?: vscode.CancellationToken,
  concurrency: number = 5,
  mode: DocstringGenerationMode = DocstringGenerationMode.GENERATE_ALL
): Promise<boolean> {
  try {
    // Ensure .cursorcrawl directory exists
    await WorkspaceService.ensureCursorCrawlDir(rootPath);
    
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
        message: `Preparing to generate missing docstrings in parallel (${validation.emptyDocstrings} symbols need processing)...` 
      });
    } else {
      progress?.report({ message: 'Preparing to generate all docstrings in parallel...' });
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
    
    // Set up progress reporting
    const progressAdapter = progress ? adaptVSCodeProgress(progress, token) : undefined;
    
    // Get files with symbols that need processing
    const filesToProcess = Object.keys(symbolIndex);
    const totalFiles = filesToProcess.length;
    
    progress?.report({ 
      message: `Processing ${totalFiles} files with maximum concurrency of ${concurrency}...`
    });
    
    // Track stats for reporting
    let skippedSymbolCount = 0;
    
    // If mode is GENERATE_MISSING, count the number of skipped symbols
    if (mode === DocstringGenerationMode.GENERATE_MISSING) {
      for (const filePath in symbolIndex) {
        const fileSymbols = symbolIndex[filePath];
        for (const symbol of fileSymbols) {
          if (!DocstringGenerationService.isEmptyDocstring(symbol.docstring)) {
            skippedSymbolCount++;
          }
        }
      }
    }
    
    try {
      // Process all files in batches
      const { processedCount, updatedIndex } = await processFilesInBatches(
        filesToProcess, 
        concurrency, 
        symbolIndex, 
        projectFiles, 
        rootPath, 
        client, 
        progressAdapter, 
        token, 
        mode
      );
      
      // Check for cancellation
      if (token?.isCancellationRequested) {
        progress?.report({ message: 'Parallel docstring generation cancelled.' });
        return false;
      }
      
      // Write the final updated symbol index to file
      await SymbolIndexService.writeSymbolIndex(rootPath, updatedIndex);
      
      // Report completion statistics
      const completionMessage = mode === DocstringGenerationMode.GENERATE_MISSING
        ? `Parallel docstring generation complete. Generated ${processedCount} docstrings, skipped ${skippedSymbolCount} existing docstrings.`
        : `Parallel docstring generation complete. Generated/updated ${processedCount} docstrings.`;
      
      progress?.report({ message: completionMessage });
      return true;
    } catch (error) {
      console.error('Error during parallel docstring generation:', error);
      
      // Try to save work done so far
      await SymbolIndexService.writeSymbolIndex(rootPath, symbolIndex);
      
      throw error;
    }
  } catch (error) {
    console.error('Error generating docstrings in parallel:', error);
    
    // Handle different error types with user-friendly messages
    let errorMessage = 'An error occurred during parallel docstring generation.';
    
    if (error instanceof Error) {
      if (error.message.includes('500')) {
        errorMessage = 'OpenAI server error (500). The service is temporarily unavailable. Please try again later.';
      } else if (error.message.includes('401') || error.message.includes('API key')) {
        errorMessage = 'Invalid or missing OpenAI API key. Please check your API key configuration.';
      } else if (error.message.includes('429') || error.message.includes('rate limit')) {
        errorMessage = 'OpenAI API rate limit exceeded. Consider reducing the concurrency setting and try again.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request to OpenAI API timed out. Please check your network connection and try again.';
      } else if (error.message.includes('retry') || (error as any).shouldCancelGeneration === true) {
        errorMessage = 'Docstring generation failed after multiple retry attempts. Please try again later.';
      } else if ((error as any).isServerError === true) {
        errorMessage = 'OpenAI service is experiencing issues. Docstring generation has been cancelled. Please try again later.';
      } else {
        // For other errors, include the actual error message
        errorMessage = `Error generating docstrings in parallel: ${error.message}`;
      }
    }
    
    vscode.window.showErrorMessage(errorMessage);
    return false;
  }
} 