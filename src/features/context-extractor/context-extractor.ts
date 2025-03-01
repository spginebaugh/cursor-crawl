import * as fs from 'fs-extra';
import * as path from 'path';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { RelevantInfo } from '@/shared/types/relevant-info';
import { FileSystemService } from '@/shared/services/file-system-service';
import { SymbolIndexAnalyzer } from './symbol-index-analyzer';

/**
 * Extracts context file references from a prompt string
 * @param promptText The prompt text to analyze
 * @returns Array of file paths referenced in the prompt
 */
export const extractContextFiles = (prompt: string): string[] => {
  // Match @filename.ext patterns in the prompt
  const fileMatches = prompt.match(/@[\w.\/-]+/g);
  
  if (!fileMatches) {
    return [];
  }
  
  // Remove @ prefix and deduplicate
  return [...new Set(fileMatches.map(match => match.substring(1).trim()))];
};

/**
 * Generates relevant information based on context files
 * @param rootPath The root path of the project
 * @param contextFiles Array of already-verified file paths from the workspace
 * @returns The filtered relevant information
 */
export const generateRelevantInfo = async (
  rootPath: string,
  contextFiles: string[],
): Promise<void> => {
  const cursorTestDir = path.join(rootPath, '.cursortest');
  
  // Load symbol index
  const symbolIndexPath = path.join(cursorTestDir, 'symbol-index.json');
  let symbolIndex: SymbolIndex = {};
  
  try {
    const symbolIndexContent = await fs.readFile(symbolIndexPath, 'utf8');
    symbolIndex = JSON.parse(symbolIndexContent);
  } catch (error) {
    console.error('Error loading symbol index:', error);
  }
  
  // Files are already resolved and validated, no need to find matches again
  const matchingFiles = contextFiles;
  
  if (matchingFiles.length === 0) {
    console.log('No matching files found.');
    return;
  }
  
  // Use the SymbolIndexAnalyzer to process the symbol index in a single pass
  const analysisResult = SymbolIndexAnalyzer.analyzeSymbolIndex(symbolIndex, matchingFiles);
  
  // Create relevant info structure
  const relevantInfo: RelevantInfo = {
    files: {},
    dependencyGraph: analysisResult.dependencyInfo,
  };
  
  // Process each file to extract relevant information
  for (const filePath of matchingFiles) {
    const absolutePath = path.join(rootPath, filePath);
    
    try {
      // Check if file exists
      await fs.pathExists(absolutePath);
      
      // Extract file content with context
      const fileContent = await extractSourceWithContext(rootPath, filePath);
      
      // Extract relevant symbols
      const relevantSymbols = await extractRelevantSymbols(rootPath, filePath, symbolIndex);
      
      // Add to relevant info
      relevantInfo.files[filePath] = {
        content: fileContent,
        symbols: relevantSymbols,
      };
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }
  
  // Write relevant info to file
  const relevantInfoPath = path.join(cursorTestDir, 'relevant-info.json');
  await fs.writeFile(relevantInfoPath, JSON.stringify(relevantInfo, null, 2));
  
  console.log(`Relevant info generated for ${Object.keys(relevantInfo.files).length} files.`);
};

// Function to extract relevant symbols from a file
const extractRelevantSymbols = async (
  rootPath: string,
  filePath: string,
  symbolIndex: SymbolIndex,
) => {
  const normalizedPath = FileSystemService.normalizeFilePath(filePath, rootPath);
  
  // Get symbols for the specified file
  const fileSymbols = symbolIndex[normalizedPath] || [];
  
  return fileSymbols;
};

// Function to extract source code with additional context from a file
const extractSourceWithContext = async (
  rootPath: string,
  filePath: string,
): Promise<string> => {
  const fullPath = path.join(rootPath, filePath);
  
  try {
    if (await fs.pathExists(fullPath)) {
      const source = await fs.readFile(fullPath, 'utf8');
      return source;
    }
    return '';
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return '';
  }
};