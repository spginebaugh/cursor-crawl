import * as fs from 'fs-extra';
import * as path from 'path';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { CodebaseContext, CodebaseContextEntry } from './codebase-context-generator';
import { OpenAiService } from '@/shared/services/openai-service';
import { WorkspaceService } from '@/shared/services/workspace-service';

// Constants
const DUPLICATE_ANALYSIS_FILENAME = 'duplicate-analysis.json';
const DUPLICATE_ANALYSIS_TYPE_FILENAME = 'duplicate-analysis-{type}.json';

const O3_MINI_MODEL = 'o3-mini';

/**
 * Interface for the duplicate logic analysis result
 */
export interface DuplicateLogicResult {
  /**
   * The filepath of the analyzed construct
   */
  filePath: string;
  
  /**
   * The name of the analyzed construct
   */
  name: string;
  
  /**
   * The type of the analyzed construct
   */
  type: string;
  
  /**
   * The duplication score (1-5)
   * 1 = Very unlikely to be duplicated
   * 5 = Very likely to be duplicated
   */
  score: number;
  
  /**
   * The filepath of the most likely duplicate (if score is 3, 4, or 5)
   */
  duplicateFilePath?: string;
  
  /**
   * The name of the most likely duplicate (if score is 3, 4, or 5)
   */
  duplicateName?: string;
}

/**
 * Interface for the structured duplicate logic analysis output
 */
export interface DuplicateLogicOutput {
  /**
   * Array of duplicate logic analysis results
   */
  results: DuplicateLogicResult[];
}

/**
 * Zod schema for duplicate logic analysis results
 */
const DuplicateLogicResultSchema = z.object({
  filePath: z.string().describe('The filepath of the analyzed construct'),
  name: z.string().describe('The name of the analyzed construct'),
  type: z.string().describe('The type of the analyzed construct'),
  score: z.number().describe('Duplication score (1-5) where 1 is unlikely and 5 is very likely duplicated'),
  duplicateFilePath: z.string().optional().describe('The filepath of the most likely duplicate construct'),
  duplicateName: z.string().optional().describe('The name of the most likely duplicate construct')
});

/**
 * Zod schema for the duplicate logic analysis output
 */
const DuplicateLogicOutputSchema = z.object({
  results: z.array(DuplicateLogicResultSchema).describe('Array of duplicate logic analysis results')
});

/**
 * Type definition for grouped code elements by type
 */
interface TypeGroupedEntries {
  [type: string]: {
    filePath: string;
    name: string;
    type: string;
    docstring: string;
  }[];
}

/**
 * Configuration for retry logic, imported from OpenAIService
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  verbose: boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 10000,
  verbose: true
};

/**
 * Service for analyzing duplicate logic in codebase
 */
export const DuplicateLogicAnalyzerService = {
  /**
   * Gets the path to the duplicate analysis file
   * @param rootPath - The workspace root path
   * @returns The path to the duplicate analysis file
   */
  getDuplicateAnalysisPath(rootPath: string): string {
    return path.join(rootPath, '.cursortest', DUPLICATE_ANALYSIS_FILENAME);
  },

  /**
   * Gets the path to a type-specific duplicate analysis file
   * @param rootPath - The workspace root path
   * @param type - The type category (e.g., 'function', 'class')
   * @returns The path to the type-specific duplicate analysis file
   */
  getTypeSpecificAnalysisPath(rootPath: string, type: string): string {
    const filename = DUPLICATE_ANALYSIS_TYPE_FILENAME.replace('{type}', type);
    return path.join(rootPath, '.cursortest', filename);
  },

  /**
   * Reads the codebase context file
   * @param rootPath - The workspace root path
   * @returns The parsed codebase context
   */
  async readCodebaseContext(rootPath: string): Promise<CodebaseContext> {
    const contextPath = path.join(rootPath, '.cursortest', 'codebase-context.json');
    
    if (!await fs.pathExists(contextPath)) {
      throw new Error('Codebase context file not found. Please generate it first using the "Generate Codebase Context" command.');
    }
    
    const contextContent = await fs.readFile(contextPath, 'utf-8');
    return JSON.parse(contextContent) as CodebaseContext;
  },

  /**
   * Groups entries by their type for chunked processing
   * @param codebaseContext - The codebase context to group
   * @returns The entries grouped by type
   */
  groupEntriesByType(codebaseContext: CodebaseContext): TypeGroupedEntries {
    const groupedEntries: TypeGroupedEntries = {};
    
    for (const [filePath, entries] of Object.entries(codebaseContext)) {
      for (const entry of entries) {
        if (!groupedEntries[entry.type]) {
          groupedEntries[entry.type] = [];
        }
        
        groupedEntries[entry.type].push({
          filePath,
          name: entry.name,
          type: entry.type,
          docstring: entry.docstring
        });
      }
    }
    
    return groupedEntries;
  },

  /**
   * Formats the code entries for the OpenAI prompt
   * @param entries - The code entries to format
   * @returns The formatted entries string
   */
  formatEntriesForPrompt(entries: Array<{filePath: string; name: string; type: string; docstring: string}>): string {
    let formattedEntries = '';
    
    for (const entry of entries) {
      formattedEntries += `\nFile: ${entry.filePath}\nName: ${entry.name}\nType: ${entry.type}\nDocstring: ${entry.docstring}\n`;
    }
    
    return formattedEntries;
  },

  /**
   * Creates the prompt for the OpenAI model
   * @param formattedEntries - The formatted code entries
   * @param typeCategory - The type category being analyzed
   * @returns The prompt for the OpenAI model
   */
  createPrompt(formattedEntries: string, typeCategory: string): string {
    return `You are tasked with analyzing a codebase for potentially duplicated logic. Below is information about ${typeCategory} in the codebase. Each entry includes the filepath, name, type, and a docstring describing what it does.

Your job is to:
1. Carefully read and understand each entry
2. Rate each entry on a scale of 1-5 based on how likely it is to contain logic that is duplicated elsewhere in the codebase:
   - 1: Very unlikely to be duplicated
   - 2: Unlikely to be duplicated
   - 3: Possibly duplicated
   - 4: Likely duplicated
   - 5: Very likely duplicated
3. Identify the name and filepath of the most likely duplicate construct

CODEBASE ${typeCategory.toUpperCase()}:
${formattedEntries}

IMPORTANT INSTRUCTIONS:
1. You MUST analyze EVERY single entry provided above. Do not skip any entries.
2. Return your analysis as a structured JSON output with the "results" array containing one object for each entry analyzed.
3. For each entry, provide:
   - filePath: The filepath of the analyzed construct (exactly as provided)
   - name: The name of the analyzed construct (exactly as provided)
   - type: The type of the analyzed construct (exactly as provided)
   - score: A number between 1 and 5 (strictly integers, no decimals)
   - duplicateFilePath: The filepath of the most likely duplicate (include for all entries)
   - duplicateName: The name of the most likely duplicate (include for all entries)
   
If the score is 1 or 2, you can use empty strings for duplicateFilePath and duplicateName.

The output format must be a JSON object with a "results" array containing EXACTLY one object for EACH entry in the input.`;
  },

  /**
   * Safely sends the prompt to the OpenAI API using structured outputs
   * @param client - The OpenAI client
   * @param prompt - The prompt to send
   * @param retryConfig - Configuration for retry behavior
   * @param entries - The entries being analyzed (for validation)
   * @returns The parsed structured output
   */
  async safeCompletionWithParse(
    client: OpenAI, 
    prompt: string,
    entries: Array<{filePath: string; name: string; type: string; docstring: string}>,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<DuplicateLogicOutput> {
    const entryCount = entries.length;
    
    // Enhanced retry config with more attempts for larger datasets
    const enhancedRetryConfig = {
      ...retryConfig,
      maxRetries: Math.max(retryConfig.maxRetries, Math.min(5, Math.ceil(entryCount / 20))),
      verbose: true
    };
    
    try {
      return await OpenAiService.withRetry(
        async () => {
          try {
            // First try the beta.chat.completions.parse method
            const completion = await client.beta.chat.completions.parse({
              model: O3_MINI_MODEL,
              messages: [
                { 
                  role: 'system', 
                  content: 'You are an expert code analyzer that identifies potentially duplicated logic in a codebase.' 
                },
                { role: 'user', content: prompt }
              ],
              response_format: zodResponseFormat(DuplicateLogicOutputSchema, "response"),
            });

            // Extract the parsed result which is already validated against the schema
            const result = completion.choices[0].message.parsed as DuplicateLogicOutput;
            
            // Validate result completeness - check if we have substantially fewer results than entries
            if (result.results.length < entryCount * 0.9) {
              console.warn(`Incomplete results detected: Received ${result.results.length} results for ${entryCount} entries`);
              throw new Error(`Incomplete results: Only ${result.results.length} of ${entryCount} entries were processed`);
            }
            
            return result;
          } catch (error) {
            // Handle various error types
            if (error instanceof Error) {
              // Check for incomplete results (our custom error)
              if (error.message.includes('Incomplete results')) {
                console.warn('Incomplete results detected, retrying with standard completion');
              }
              
              // Check if it's a beta API error
              else if (
                error.message.includes('500') || 
                error.message.includes('beta') ||
                error.message.includes('parse') ||
                error.message.includes('content_filter')
              ) {
                console.warn('Beta API failed, falling back to standard chat completion:', error);
              } else {
                // Unexpected error, just log and rethrow
                console.error('Unexpected error in API call:', error);
                throw error;
              }
              
              // Try standard completion as fallback
              const fallbackCompletion = await client.chat.completions.create({
                model: O3_MINI_MODEL,
                messages: [
                  { 
                    role: 'system', 
                    content: 'You are an expert code analyzer that identifies potentially duplicated logic in a codebase. Return ONLY valid JSON matching this schema: ' + JSON.stringify(DuplicateLogicOutputSchema.shape) 
                  },
                  { role: 'user', content: prompt + '\n\nReturn ONLY valid JSON with no explanation.' }
                ],
                response_format: { type: "json_object" },
                temperature: 0, // Lower temperature for more consistent results
              });

              const content = fallbackCompletion.choices[0].message.content;
              if (!content) {
                throw new Error('Empty response from OpenAI API');
              }

              try {
                // Parse and validate the JSON response
                const parsedResult = DuplicateLogicOutputSchema.parse(JSON.parse(content)) as DuplicateLogicOutput;
                
                // Validate result completeness
                if (parsedResult.results.length < entryCount * 0.9) {
                  console.warn(`Incomplete results from fallback: Received ${parsedResult.results.length} results for ${entryCount} entries`);
                  throw new Error(`Incomplete results from fallback: Only ${parsedResult.results.length} of ${entryCount} entries were processed`);
                }
                
                return parsedResult;
              } catch (parseError) {
                console.error('Failed to parse fallback response:', parseError);
                throw new Error('Failed to parse response: ' + String(parseError));
              }
            }
            throw error;
          }
        },
        enhancedRetryConfig
      );
    } catch (error) {
      // Check if this error occurred after exhausting retries
      if (error instanceof Error && (error as any).retriesExhausted) {
        console.error('All retry attempts failed in safeCompletionWithParse:', error);
        
        // Create a fallback with default scores if we absolutely can't get results
        if (error.message.includes('Incomplete results')) {
          console.warn('Creating fallback results after exhausting retries');
          
          // Generate a basic result for each entry with conservative scores
          const fallbackResults: DuplicateLogicResult[] = entries.map(entry => ({
            filePath: entry.filePath,
            name: entry.name,
            type: entry.type,
            score: 1, // Conservative default score
            // No duplicate info for fallback entries
          }));
          
          return { results: fallbackResults };
        }
        
        // For other errors, just throw
        const enhancedError = new Error(`Persistent OpenAI API errors after multiple retries: ${error.message}`);
        throw enhancedError;
      }
      
      throw error;
    }
  },

  /**
   * Writes the results to a JSON file
   * @param rootPath - The workspace root path
   * @param results - The results to write
   * @param filename - The filename to use (optional, defaults to DUPLICATE_ANALYSIS_FILENAME)
   * @returns The path to the written file
   */
  async writeResults(rootPath: string, results: DuplicateLogicOutput, filename?: string): Promise<string> {
    const outputPath = path.join(rootPath, '.cursortest', filename || DUPLICATE_ANALYSIS_FILENAME);
    
    // Ensure the directory exists
    await fs.ensureDir(path.dirname(outputPath));
    
    // Write the results as JSON
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    
    return outputPath;
  },

  /**
   * Process a chunk of the codebase (entries of a specific type)
   * @param client - The OpenAI client
   * @param entries - The entries to process
   * @param typeCategory - The type category being processed
   * @param rootPath - The workspace root path
   * @param progressCallback - Optional callback for progress reporting
   * @returns The analysis results for this chunk
   */
  async processChunk(
    client: OpenAI,
    entries: Array<{filePath: string; name: string; type: string; docstring: string}>,
    typeCategory: string,
    rootPath: string,
    progressCallback?: (message: string) => void
  ): Promise<DuplicateLogicResult[]> {
    // Format entries for this type
    const formattedEntries = this.formatEntriesForPrompt(entries);
    
    // Create the prompt
    const prompt = this.createPrompt(formattedEntries, typeCategory);
    
    try {
      // Send to OpenAI with structured output
      progressCallback?.(`Analyzing ${entries.length} ${typeCategory}s...`);
      const output = await this.safeCompletionWithParse(client, prompt, entries);
      
      // Additional validation of results
      this.validateResults(output.results, entries);
      
      // Write the type-specific results to a separate JSON file
      const typeSpecificFilename = DUPLICATE_ANALYSIS_TYPE_FILENAME.replace('{type}', typeCategory);
      const typePath = await this.writeResults(
        rootPath, 
        output, 
        typeSpecificFilename
      );
      
      progressCallback?.(`Wrote ${output.results.length} ${typeCategory} results to ${typePath}`);
      
      return output.results;
    } catch (error: unknown) {
      // Log the error
      console.error(`Error processing ${typeCategory} entries:`, error);
      progressCallback?.(`Error processing ${typeCategory} entries: ${error instanceof Error ? error.message : String(error)}`);
      
      // Create a minimal fallback result for each entry
      progressCallback?.(`Creating fallback results for ${entries.length} ${typeCategory}s`);
      const fallbackResults = this.createFallbackResults(entries);
      
      // Write the fallback results
      const typeSpecificFilename = DUPLICATE_ANALYSIS_TYPE_FILENAME.replace('{type}', `${typeCategory}-fallback`);
      const typePath = await this.writeResults(
        rootPath, 
        { results: fallbackResults }, 
        typeSpecificFilename
      );
      
      progressCallback?.(`Wrote ${fallbackResults.length} fallback ${typeCategory} results to ${typePath}`);
      
      return fallbackResults;
    }
  },

  /**
   * Creates fallback results when API processing fails
   * @param entries - The entries to create fallback results for
   * @returns Array of fallback results
   */
  createFallbackResults(
    entries: Array<{filePath: string; name: string; type: string; docstring: string}>
  ): DuplicateLogicResult[] {
    return entries.map(entry => ({
      filePath: entry.filePath,
      name: entry.name,
      type: entry.type,
      score: 1, // Conservative default score
      duplicateFilePath: "",
      duplicateName: "",
    }));
  },

  /**
   * Validates the results against the original entries
   * @param results - The results to validate
   * @param entries - The original entries
   * @throws Error if validation fails
   */
  validateResults(
    results: DuplicateLogicResult[],
    entries: Array<{filePath: string; name: string; type: string; docstring: string}>
  ): void {
    // Check if we're missing more than 10% of the entries
    if (results.length < entries.length * 0.9) {
      throw new Error(`Incomplete results: Only ${results.length} of ${entries.length} entries were processed`);
    }
    
    // Check for any malformed results
    const missingFields = results.filter(result => 
      !result.filePath || 
      !result.name || 
      !result.type || 
      typeof result.score !== 'number' ||
      result.score < 1 || 
      result.score > 5
    );
    
    if (missingFields.length > 0) {
      console.warn(`Found ${missingFields.length} results with missing or invalid fields`);
      
      // Only throw if more than 5% of results are invalid
      if (missingFields.length > results.length * 0.05) {
        throw new Error(`Too many malformed results: ${missingFields.length} results have missing or invalid fields`);
      }
    }
  },

  /**
   * Analyzes the codebase context for duplicate logic, processing by type chunks
   * @param rootPath - The workspace root path
   * @param progressCallback - Optional callback for progress reporting
   * @returns Path to the combined output JSON file
   */
  async analyzeDuplicateLogic(
    rootPath: string, 
    progressCallback?: (message: string) => void
  ): Promise<string> {
    // Read the codebase context
    const codebaseContext = await this.readCodebaseContext(rootPath);
    
    // Get environment variables for OpenAI
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    // Create OpenAI client
    const client = OpenAiService.createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    // Group entries by type
    const groupedEntries = this.groupEntriesByType(codebaseContext);
    
    // Process each type group
    progressCallback?.(`Grouped codebase into ${Object.keys(groupedEntries).length} type categories`);
    
    const allResults: DuplicateLogicResult[] = [];
    let processedTypes = 0;
    
    for (const [typeCategory, entries] of Object.entries(groupedEntries)) {
      processedTypes++;
      progressCallback?.(`Processing ${entries.length} ${typeCategory}s (${processedTypes}/${Object.keys(groupedEntries).length})`);
      
      const results = await this.processChunk(client, entries, typeCategory, rootPath, progressCallback);
      allResults.push(...results);
      
      progressCallback?.(`Completed ${typeCategory}s: ${results.length} results`);
    }
    
    // Write the combined results to a file
    progressCallback?.(`Writing combined results (${allResults.length} entries) to JSON file`);
    const combinedOutput: DuplicateLogicOutput = { results: allResults };
    return this.writeResults(rootPath, combinedOutput);
  }
}; 