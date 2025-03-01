import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SymbolIndexEntry } from '@/types/symbol-index';
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

      // Use the parse method with zodResponseFormat instead of regular chat completion
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
      const result = completion.choices[0].message.parsed;
      return result as DocstringOutput;

    } catch (error) {
      console.error('Error generating structured docstrings:', error);
      // Return empty docstrings if API call fails
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