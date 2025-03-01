import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SymbolIndexEntry } from '@/shared/types/symbol-index';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

interface EnvVars {
  OPENAI_API_KEY?: string;
}

const openaiModel = 'o3-mini';

// Define structured output schema for OpenAI response
export interface DocstringOutput {
  docstrings: Array<{
    name: string;
    docstring: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'enum' | 'other';
    line: number;
  }>;
}

// Define Zod schema for the docstring response
const DocstringSchema = z.object({
  docstrings: z.array(
    z.object({
      name: z.string().describe('The name of the function/method'),
      type: z.enum(['function', 'class', 'interface', 'type', 'variable', 'method', 'enum', 'other']).describe('The type of the node (function, class, etc.)'),
      line: z.number().describe('The line number where the node starts'),
      docstring: z.string().describe('The generated JSDoc comment block')
    })
  )
});

/**
 * Configuration for retry logic
 */
interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay before first retry (in milliseconds) */
  initialDelayMs: number;
  /** Factor to multiply delay by after each retry */
  backoffFactor: number;
  /** Maximum delay between retries (in milliseconds) */
  maxDelayMs: number;
  /** Whether to log detailed retry information */
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
 * Service for OpenAI API operations
 */
export const OpenAiService = {
  /**
   * Loads environment variables from .env.local file
   * @param workspaceFolder - The workspace folder path
   * @returns An object containing loaded environment variables
   */
  loadEnvironmentVars(workspaceFolder?: string): EnvVars {
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
  },

  /**
   * Creates an OpenAI API client using the API key
   * @param apiKey - The OpenAI API key
   * @returns An OpenAI API client instance
   */
  createOpenAIClient(apiKey?: string): OpenAI | undefined {
    if (!apiKey) {
      console.error('OpenAI API key not found');
      return undefined;
    }
    
    return new OpenAI({
      apiKey,
    });
  },

  /**
   * Executes a function with retry logic using exponential backoff
   * @param operation - Async function to execute with retry logic
   * @param retryConfig - Configuration for retry behavior
   * @returns Promise resolving to the operation result
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: unknown;
    let delay = retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0 && retryConfig.verbose) {
          console.log(`Retry attempt ${attempt}/${retryConfig.maxRetries} after ${delay}ms delay...`);
        }

        // Execute the operation
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if we've reached max retries
        if (attempt >= retryConfig.maxRetries) {
          if (retryConfig.verbose) {
            console.error(`All ${retryConfig.maxRetries} retry attempts failed.`);
          }
          
          // Enhance the error message to indicate retry exhaustion
          if (error instanceof Error) {
            error.message = `After ${retryConfig.maxRetries} retry attempts: ${error.message}`;
            // Add a marker property to indicate this error persisted after retries
            (error as any).retriesExhausted = true;
          }
          
          break;
        }

        // Check if error is retryable (5xx status codes are usually temporary server errors)
        const isRetryable = error instanceof Error && 
          (error.message.includes('500') || 
           error.message.includes('502') || 
           error.message.includes('503') || 
           error.message.includes('504') ||
           error.message.includes('rate limit') ||
           error.message.includes('timeout'));

        if (!isRetryable) {
          if (retryConfig.verbose) {
            console.error('Non-retryable error encountered:', error);
          }
          break;
        }

        // Log the error
        if (retryConfig.verbose) {
          console.warn(`Attempt ${attempt + 1} failed:`, error);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));

        // Increase delay for next retry using exponential backoff
        delay = Math.min(delay * retryConfig.backoffFactor, retryConfig.maxDelayMs);
      }
    }

    // If we got here, all retries failed
    throw lastError;
  },

  /**
   * Safely generates docstrings for multiple code elements using standard completion
   * @param client - The OpenAI API client
   * @param prompt - The prompt to send to the API
   * @param retryConfig - Configuration for retry behavior
   * @returns Promise resolving to the parsed response
   */
  async safeCompletionWithParse(
    client: OpenAI, 
    prompt: string,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<DocstringOutput> {
    try {
      return await this.withRetry(
        async () => {
          try {
            // First try the beta.chat.completions.parse method
            const completion = await client.beta.chat.completions.parse({
              model: openaiModel,
              messages: [
                { 
                  role: 'system', 
                  content: 'You are a helpful assistant that generates high-quality TypeScript docstrings.' 
                },
                { role: 'user', content: prompt }
              ],
              response_format: zodResponseFormat(DocstringSchema, "response"),
            });

            // Extract the parsed result which is already validated against the schema
            return completion.choices[0].message.parsed as DocstringOutput;
          } catch (error) {
            // If the beta API fails, try the standard chat completion as fallback
            if (error instanceof Error && (
                error.message.includes('500') || 
                error.message.includes('beta') ||
                error.message.includes('parse'))) {
              console.warn('Beta API failed, falling back to standard chat completion:', error);
              
              const fallbackCompletion = await client.chat.completions.create({
                model: openaiModel,
                messages: [
                  { 
                    role: 'system', 
                    content: 'You are a helpful assistant that generates high-quality TypeScript docstrings. Return ONLY valid JSON matching this schema: ' + JSON.stringify(DocstringSchema.shape) 
                  },
                  { role: 'user', content: prompt + '\n\nReturn ONLY valid JSON with no explanation.' }
                ],
                response_format: { type: "json_object" },
              });

              const content = fallbackCompletion.choices[0].message.content;
              if (!content) {
                throw new Error('Empty response from OpenAI API');
              }

              try {
                // Parse and validate the JSON response
                return DocstringSchema.parse(JSON.parse(content)) as DocstringOutput;
              } catch (parseError) {
                console.error('Failed to parse fallback response:', parseError);
                throw new Error('Failed to parse response: ' + String(parseError));
              }
            }
            throw error;
          }
        },
        retryConfig
      );
    } catch (error) {
      // Check if this error occurred after exhausting retries
      if (error instanceof Error && (error as any).retriesExhausted) {
        console.error('All retry attempts failed in safeCompletionWithParse:', error);
        
        // Create enhanced error for cancellation handling
        const enhancedError = new Error(`Persistent OpenAI API errors after multiple retries: ${error.message}`);
        (enhancedError as any).shouldCancelGeneration = true;
        throw enhancedError;
      }
      
      throw error;
    }
  },

  /**
   * Generates docstrings for multiple code elements in a file using OpenAI
   * @param client - The OpenAI API client
   * @param fileContent - The complete file content
   * @param nodes - Information about the nodes that need docstrings
   * @returns Object containing generated docstrings for each node
   */
  async generateDocstringsStructured(
    client: OpenAI,
    fileContent: string,
    nodes: Array<{
      name: string;
      type: SymbolIndexEntry['type'];
      location: { line: number; character: number };
      snippet: string;
    }>
  ): Promise<DocstringOutput> {
    try {
      const prompt = `I need JSDoc style docstrings for specific declarations in this TypeScript file. 
Here's the complete file content for context:

\`\`\`typescript
${fileContent}
\`\`\`

Generate docstrings for the following declarations (identified by name, type, and line number):
${JSON.stringify(nodes, null, 2)}

For each declaration, provide a comprehensive docstring that explains what it does, its parameters, return type, and possible errors.
Be concise but complete. Return the docstrings as structured data.`;

      // Use the retry-enabled safe completion function
      return await this.safeCompletionWithParse(client, prompt);

    } catch (error) {
      console.error('Error generating structured docstrings:', error);
      
      // Show more detailed error information to help with debugging
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
          shouldCancel: (error as any).shouldCancelGeneration === true
        });
        
        // If the error indicates we should cancel generation, don't return fallback docstrings
        if ((error as any).shouldCancelGeneration === true) {
          // Provide user-friendly notification
          vscode.window.showErrorMessage(`Docstring generation cancelled: ${error.message}`);
          
          // Re-throw the error to stop the process
          throw error;
        }
        
        // For server errors that are temporary, show a notification but continue with fallback
        if ((error as any).isServerError === true) {
          vscode.window.showWarningMessage(`OpenAI server error encountered. Using simple docstrings as fallback.`);
        } else {
          // For other errors, show a generic error message
          vscode.window.showErrorMessage(`Failed to generate docstrings: ${error.message}. Using fallback docstrings.`);
        }
      }
      
      // Return empty docstrings if API call fails (but only for non-cancellation errors)
      return {
        docstrings: nodes.map(node => ({
          name: node.name,
          type: node.type,
          line: node.location.line,
          docstring: `/**\n * ${node.name}\n */`
        }))
      };
    }
  },

  /**
   * Generates a docstring for a single code element using OpenAI
   * @param client - The OpenAI API client
   * @param codeSnippet - The code snippet
   * @param functionName - The name of the function
   * @returns The generated docstring
   */
  async generateDocstring(
    client: OpenAI,
    codeSnippet: string,
    functionName: string
  ): Promise<string> {
    try {
      const result = await this.generateDocstringsStructured(client, codeSnippet, [{
        name: functionName,
        type: 'function', // Assume function as default type
        location: { line: 1, character: 0 },
        snippet: codeSnippet
      }]);

      const docstring = result.docstrings[0]?.docstring || `/**\n * ${functionName}\n */`;
      return docstring;
    } catch (error) {
      console.error(`Error generating docstring for ${functionName}:`, error);
      return `/**\n * ${functionName}\n */`;
    }
  }
}; 