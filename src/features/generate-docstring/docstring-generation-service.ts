import OpenAI from 'openai';
import { OpenAiService } from '@/shared/services/openai-service';
import { SymbolIndexEntry } from '@/shared/types/symbol-index';

/**
 * Service for generating docstrings using OpenAI
 */
export const DocstringGenerationService = {
  /**
   * Determines if a docstring is empty or missing
   * @param docstring - The docstring to check
   * @returns True if the docstring is empty or missing
   */
  isEmptyDocstring: (docstring?: string): boolean => {
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
  },

  /**
   * Pure function to process symbols and generate docstrings using the OpenAI API
   * @param params - Object containing file content, symbols to process, and OpenAI client
   * @returns Promise resolving to array of symbols with updated docstrings
   */
  generateDocstringsForSymbols: async ({
    fileContent,
    symbols,
    client
  }: {
    fileContent: string;
    symbols: SymbolIndexEntry[];
    client: OpenAI;
  }): Promise<SymbolIndexEntry[]> => {
    try {
      // Extract node information to pass to the model
      const nodeInfos = symbols.map(symbol => ({
        name: symbol.name,
        // Map 'method' and 'enum' to 'function' and 'other' for compatibility with OpenAI's expected input
        type: (symbol.type === 'method' ? 'function' : 
               symbol.type === 'enum' ? 'other' : 
               symbol.type) as 'function' | 'class' | 'interface' | 'type' | 'variable' | 'other',
        location: symbol.location,
        snippet: symbol.snippet,
      }));
      
      // Generate docstrings using the structured approach
      const output = await OpenAiService.generateDocstringsStructured(client, fileContent, nodeInfos);
      
      // Map the generated docstrings back to the original symbols
      const updatedSymbols = [...symbols];
      
      for (const generatedDocstring of output.docstrings) {
        // Find matching symbol by name and type
        const symbolIndex = updatedSymbols.findIndex(
          s => s.name === generatedDocstring.name && 
               (s.type === generatedDocstring.type || 
                (s.type === 'method' && generatedDocstring.type === 'function') ||
                (s.type === 'enum' && generatedDocstring.type === 'other'))
        );
        
        if (symbolIndex !== -1) {
          updatedSymbols[symbolIndex] = {
            ...updatedSymbols[symbolIndex],
            docstring: generatedDocstring.docstring
          };
        }
      }
      
      return updatedSymbols;
    } catch (error) {
      console.error('Error generating docstrings:', error);
      
      // Create an enhanced error that includes cancellation information
      const enhancedError = error instanceof Error 
        ? error 
        : new Error('Unknown error during docstring generation');
      
      // Add a property to indicate this error persisted after retries
      if (error instanceof Error && 
         (error.message.includes('after retry') || 
          error.message.includes('All retry attempts failed'))) {
        (enhancedError as any).shouldCancelGeneration = true;
      }
      
      // Add a property for server errors that might need cancellation
      if (error instanceof Error && 
         (error.message.includes('500 ') || 
          error.message.includes('502 ') ||
          error.message.includes('503 ') ||
          error.message.includes('504 '))) {
        (enhancedError as any).isServerError = true;
      }
      
      throw enhancedError;
    }
  },

  /**
   * Validates the symbol index, counting filled and empty docstrings
   * @param symbolIndex - The symbol index to validate
   * @returns Validation results with counts
   */
  validateSymbolIndex: (symbolIndex: { [filePath: string]: SymbolIndexEntry[] }): { 
    totalSymbols: number; 
    filledDocstrings: number; 
    emptyDocstrings: number 
  } => {
    let totalSymbols = 0;
    let filledDocstrings = 0;
    let emptyDocstrings = 0;
    
    // Process each file in the index
    for (const filePath in symbolIndex) {
      const fileSymbols = symbolIndex[filePath];
      totalSymbols += fileSymbols.length;
      
      // Check each symbol
      for (const symbol of fileSymbols) {
        if (DocstringGenerationService.isEmptyDocstring(symbol.docstring)) {
          emptyDocstrings++;
        } else {
          filledDocstrings++;
        }
      }
    }
    
    return {
      totalSymbols,
      filledDocstrings,
      emptyDocstrings
    };
  }
}; 