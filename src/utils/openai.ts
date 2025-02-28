import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import * as vscode from 'vscode';

interface EnvVars {
  OPENAI_API_KEY?: string;
}

/**
 * Loads environment variables from .env.local file
 * @param workspaceFolder - The workspace folder path
 * @returns An object containing loaded environment variables
 */
export const loadEnvironmentVars = (workspaceFolder?: string): EnvVars => {
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
};

/**
 * Creates an OpenAI API client using the API key
 * @param apiKey - The OpenAI API key
 * @returns An OpenAI API client instance
 */
export const createOpenAIClient = (apiKey?: string): OpenAI | undefined => {
  if (!apiKey) {
    console.error('OpenAI API key not found');
    return undefined;
  }
  
  return new OpenAI({
    apiKey,
  });
};

/**
 * Generates a docstring for a function or class using OpenAI
 * @param client - The OpenAI API client
 * @param codeSnippet - The code snippet to generate a docstring for
 * @param functionName - The name of the function or class
 * @returns The generated docstring
 */
export const generateDocstring = async (
  client: OpenAI,
  codeSnippet: string,
  functionName: string
): Promise<string> => {
  try {
    const prompt = `Generate a comprehensive JSDoc style docstring for the following TypeScript code. 
Focus on explaining what the function/class does, all parameters, return type, and possible errors.
Be concise but complete.

Code:
\`\`\`typescript
${codeSnippet}
\`\`\`

Return only the JSDoc comment block (with /** and */), nothing else.`;

    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates high-quality TypeScript docstrings.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message.content?.trim() || '';
    return content;
  } catch (error) {
    console.error('Error generating docstring:', error);
    return `/**\n * ${functionName}\n */`;
  }
};