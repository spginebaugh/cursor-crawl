import * as fs from 'fs-extra';
import * as path from 'path';
import OpenAI from 'openai';
import { CodebaseContext, CodebaseContextEntry } from './codebase-context-generator';
import { OpenAiService } from '@/shared/services/openai-service';
import { WorkspaceService } from '@/shared/services/workspace-service';

// Constants
const DUPLICATE_ANALYSIS_FILENAME = 'duplicate-analysis.csv';
const O1_MODEL = 'o1';

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
   * Formats the codebase context for the OpenAI prompt
   * @param codebaseContext - The codebase context to format
   * @returns The formatted context string
   */
  formatContextForPrompt(codebaseContext: CodebaseContext): string {
    let formattedContext = '';
    
    for (const [filePath, entries] of Object.entries(codebaseContext)) {
      for (const entry of entries) {
        formattedContext += `\nFile: ${filePath}\nName: ${entry.name}\nType: ${entry.type}\nDocstring: ${entry.docstring}\n`;
      }
    }
    
    return formattedContext;
  },

  /**
   * Creates the prompt for the OpenAI model
   * @param formattedContext - The formatted codebase context
   * @returns The prompt for the OpenAI model
   */
  createPrompt(formattedContext: string): string {
    return `You are tasked with analyzing a codebase for potentially duplicated logic. Below is information about functions, classes, methods, and other constructs in the codebase. Each entry includes the filepath, name, type, and a docstring describing what it does.

Your job is to:
1. Carefully read and understand each entry
2. Rate each entry on a scale of 1-5 based on how likely it is to contain logic that is duplicated elsewhere in the codebase:
   - 1: Very unlikely to be duplicated
   - 2: Unlikely to be duplicated
   - 3: Possibly duplicated
   - 4: Likely duplicated
   - 5: Very likely duplicated
3. For entries with a score of 3, 4, or 5, identify the name and filepath of the most likely duplicate

CODEBASE CONTEXT:
${formattedContext}

OUTPUT INSTRUCTIONS:
- Format your response as CSV with the following columns:
- id,input_filepath,input_name,input_type,score,duplicate_filepath,duplicate_name
- For entries with score 1-2, leave duplicate_filepath and duplicate_name empty
- For entries with score 3-5, include duplicate_filepath and duplicate_name when you can identify a likely duplicate
- Include header row
- Number each row with a unique id starting from 1
- Only output the CSV data, no explanations or other text`;
  },

  /**
   * Sends the prompt to the OpenAI API
   * @param client - The OpenAI client
   * @param prompt - The prompt to send
   * @returns The API response
   */
  async sendToOpenAI(client: OpenAI, prompt: string): Promise<string> {
    try {
      const completion = await client.chat.completions.create({
        model: O1_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert code analyzer that identifies potentially duplicated logic in a codebase.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2, // Lower temperature for more deterministic output
      });
      
      return completion.choices[0].message.content || '';
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw new Error(`Failed to analyze codebase: ${error}`);
    }
  },

  /**
   * Parses the OpenAI response into DuplicateLogicResult objects
   * @param response - The OpenAI response
   * @returns The parsed duplicate logic results
   */
  parseResponse(response: string): DuplicateLogicResult[] {
    const lines = response.trim().split('\n');
    const results: DuplicateLogicResult[] = [];
    
    // Skip header row if present
    const startIndex = lines[0].toLowerCase().includes('id,') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {continue;}
      
      const parts = line.split(',').map(part => part.trim());
      
      // Ensure we have at least 5 parts (id, filepath, name, type, score)
      if (parts.length < 5) {continue;}
      
      const result: DuplicateLogicResult = {
        filePath: this.cleanCsvField(parts[1]),
        name: this.cleanCsvField(parts[2]),
        type: this.cleanCsvField(parts[3]),
        score: parseInt(parts[4], 10)
      };
      
      // Add duplicate info if present and score is 3+
      if (result.score >= 3 && parts.length > 5) {
        result.duplicateFilePath = this.cleanCsvField(parts[5]);
        
        if (parts.length > 6) {
          result.duplicateName = this.cleanCsvField(parts[6]);
        }
      }
      
      results.push(result);
    }
    
    return results;
  },

  /**
   * Cleans a CSV field by removing quotes if present
   * @param field - The CSV field to clean
   * @returns The cleaned field
   */
  cleanCsvField(field: string): string {
    // Remove surrounding quotes if present
    if (field.startsWith('"') && field.endsWith('"')) {
      return field.substring(1, field.length - 1);
    }
    return field;
  },

  /**
   * Formats the results as a CSV string
   * @param results - The duplicate logic results
   * @returns The formatted CSV string
   */
  formatResultsAsCsv(results: DuplicateLogicResult[]): string {
    let csv = 'id,input_filepath,input_name,input_type,score,duplicate_filepath,duplicate_name\n';
    
    results.forEach((result, index) => {
      csv += `${index + 1},${this.escapeCsvField(result.filePath)},${this.escapeCsvField(result.name)},${this.escapeCsvField(result.type)},${result.score},`;
      
      if (result.score >= 3 && result.duplicateFilePath) {
        csv += `${this.escapeCsvField(result.duplicateFilePath)},`;
        csv += result.duplicateName ? `${this.escapeCsvField(result.duplicateName)}` : '';
      } else {
        csv += ',';
      }
      
      csv += '\n';
    });
    
    return csv;
  },

  /**
   * Escapes a field for CSV formatting
   * @param field - The field to escape
   * @returns The escaped field
   */
  escapeCsvField(field: string): string {
    // If the field contains commas, quotes, or newlines, wrap it in quotes and escape any quotes
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  },

  /**
   * Writes the results to a CSV file
   * @param rootPath - The workspace root path
   * @param results - The duplicate logic results
   * @returns The path to the written file
   */
  async writeResults(rootPath: string, csv: string): Promise<string> {
    return WorkspaceService.writeCursorTestFile(rootPath, DUPLICATE_ANALYSIS_FILENAME, csv);
  },

  /**
   * Analyzes the codebase context for duplicate logic
   * @param rootPath - The workspace root path
   * @returns Path to the output CSV file
   */
  async analyzeDuplicateLogic(rootPath: string): Promise<string> {
    // Read the codebase context
    const codebaseContext = await this.readCodebaseContext(rootPath);
    
    // Get environment variables for OpenAI
    const envVars = OpenAiService.loadEnvironmentVars(rootPath);
    
    // Create OpenAI client
    const client = OpenAiService.createOpenAIClient(envVars.OPENAI_API_KEY);
    if (!client) {
      throw new Error('OpenAI client not created. Check your API key configuration.');
    }
    
    // Format the context and create the prompt
    const formattedContext = this.formatContextForPrompt(codebaseContext);
    const prompt = this.createPrompt(formattedContext);
    
    // Send to OpenAI
    const response = await this.sendToOpenAI(client, prompt);
    
    // Write the results to a file (using raw response as it's already in CSV format)
    return this.writeResults(rootPath, response);
  }
}; 