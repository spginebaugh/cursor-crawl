import * as fs from 'fs-extra';
import * as path from 'path';
import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';
import { ScoreInfo, SymbolIndexWithScores, SymbolIndexEntryWithScores } from '@/shared/types/symbol-index-with-scores';
import { WorkspaceService } from '@/shared/services/workspace-service';

// Constants
const SYMBOL_INDEX_FILENAME = 'symbol-index.json';
const DUPLICATE_ANALYSIS_FILENAME = 'duplicate-analysis.json';
const MERGED_JSON_FILENAME = 'merged-json-for-viz.json';

/**
 * Interface for duplicate analysis entry
 */
export interface DuplicateAnalysisEntry {
  filePath: string;
  name: string;
  type: string;
  score: number;
  duplicateFilePath?: string;
  duplicateName?: string;
}

/**
 * Service for merging symbol index and duplicate analysis data
 */
export const MergeJsonService = {
  /**
   * Gets the path to the source files and output file
   * @param rootPath - The workspace root path
   * @returns The paths to the source and output files
   */
  getFilePaths(rootPath: string) {
    const cursorTestDir = WorkspaceService.getCursorTestDir(rootPath);
    return {
      symbolIndexPath: path.join(cursorTestDir, SYMBOL_INDEX_FILENAME),
      duplicateAnalysisPath: path.join(cursorTestDir, DUPLICATE_ANALYSIS_FILENAME),
      mergedJsonPath: path.join(cursorTestDir, MERGED_JSON_FILENAME)
    };
  },

  /**
   * Reads the symbol index from disk
   * @param symbolIndexPath - Path to the symbol index file
   * @returns The symbol index
   */
  async readSymbolIndex(symbolIndexPath: string): Promise<SymbolIndex> {
    try {
      if (!await fs.pathExists(symbolIndexPath)) {
        throw new Error(`Symbol index not found at: ${symbolIndexPath}`);
      }
      return await fs.readJson(symbolIndexPath) as SymbolIndex;
    } catch (error) {
      console.error('Error reading symbol index:', error);
      throw error;
    }
  },

  /**
   * Reads the duplicate analysis data from disk
   * @param duplicateAnalysisPath - Path to the duplicate analysis file
   * @returns The duplicate analysis data normalized to an array of entries
   */
  async readDuplicateAnalysis(duplicateAnalysisPath: string): Promise<DuplicateAnalysisEntry[]> {
    try {
      if (!await fs.pathExists(duplicateAnalysisPath)) {
        throw new Error(`Duplicate analysis not found at: ${duplicateAnalysisPath}`);
      }
      
      // Read the raw data first
      const rawData = await fs.readJson(duplicateAnalysisPath);
      
      // Debug log to see the structure
      console.log('Duplicate analysis raw data structure:', 
        `Type: ${typeof rawData}, ` +
        `Is Array: ${Array.isArray(rawData)}, ` + 
        `Keys: ${typeof rawData === 'object' && rawData !== null ? Object.keys(rawData).join(', ') : 'none'}`
      );
      
      // Sample data if available
      if (typeof rawData === 'object' && rawData !== null) {
        if (Array.isArray(rawData) && rawData.length > 0) {
          console.log('Sample array item:', JSON.stringify(rawData[0]).substring(0, 200));
        } else {
          const sampleKey = Object.keys(rawData)[0];
          if (sampleKey) {
            console.log('Sample object property:', sampleKey, JSON.stringify(rawData[sampleKey]).substring(0, 200));
          }
        }
      }
      
      // Normalize the data to an array of entries
      let normalizedData: DuplicateAnalysisEntry[] = [];
      
      // Try different approaches to parse the data based on common structures
      try {
        if (Array.isArray(rawData)) {
          // Data is already an array
          normalizedData = this.normalizeArrayData(rawData);
        } else if (typeof rawData === 'object' && rawData !== null) {
          // Data is an object, try different approaches
          normalizedData = this.normalizeObjectData(rawData);
        }
      } catch (parseError) {
        console.error('Error parsing duplicate analysis data:', parseError);
        // Continue with empty array if parsing fails
      }
      
      console.log(`Normalized duplicate analysis data: ${normalizedData.length} entries`);
      if (normalizedData.length > 0) {
        console.log('First normalized entry:', JSON.stringify(normalizedData[0]));
      }
      
      return normalizedData;
    } catch (error) {
      console.error('Error reading duplicate analysis:', error);
      throw error;
    }
  },
  
  /**
   * Normalizes array data to the expected format
   * @param data - The raw array data
   * @returns Normalized array of DuplicateAnalysisEntry objects
   */
  normalizeArrayData(data: any[]): DuplicateAnalysisEntry[] {
    return data
      .filter(item => item && typeof item === 'object')
      .map(item => {
        // Create a proper entry with required fields
        const entry: DuplicateAnalysisEntry = {
          name: this.getStringProperty(item, 'name', ''),
          filePath: this.getStringProperty(item, 'filePath', ''),
          type: this.getStringProperty(item, 'type', 'function'),
          score: this.getNumberProperty(item, 'score', 0)
        };
        
        // Add optional fields if present
        if ('duplicateFilePath' in item) {
          entry.duplicateFilePath = this.getStringProperty(item, 'duplicateFilePath', '');
        }
        
        if ('duplicateName' in item) {
          entry.duplicateName = this.getStringProperty(item, 'duplicateName', '');
        }
        
        return entry;
      })
      // Filter out entries without required fields
      .filter(entry => entry.name && entry.filePath);
  },
  
  /**
   * Normalizes object data to the expected format
   * @param data - The raw object data
   * @returns Normalized array of DuplicateAnalysisEntry objects
   */
  normalizeObjectData(data: Record<string, any>): DuplicateAnalysisEntry[] {
    const result: DuplicateAnalysisEntry[] = [];
    
    // Case 1: Object with 'entries' property that is an array
    if ('entries' in data && Array.isArray(data.entries)) {
      return this.normalizeArrayData(data.entries);
    }
    
    // Case 2: Object with results property that is an array
    if ('results' in data && Array.isArray(data.results)) {
      return this.normalizeArrayData(data.results);
    }
    
    // Case 3: Object where keys might be filePaths and values are entries or arrays of entries
    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Value is an array of entries
        result.push(...this.normalizeArrayData(value));
      } else if (value && typeof value === 'object') {
        // Value is a single entry or an object with entries
        if ('name' in value && 'score' in value) {
          // It's likely a single entry
          const entry: DuplicateAnalysisEntry = {
            name: this.getStringProperty(value, 'name', ''),
            filePath: this.getStringProperty(value, 'filePath', key), // Use key as filePath if not present
            type: this.getStringProperty(value, 'type', 'function'),
            score: this.getNumberProperty(value, 'score', 0)
          };
          
          if (entry.name && entry.filePath) {
            result.push(entry);
          }
        } else {
          // It might be an object with entries as properties
          Object.entries(value).forEach(([subKey, subValue]) => {
            if (subValue && typeof subValue === 'object' && 'name' in subValue && 'score' in subValue) {
              const entry: DuplicateAnalysisEntry = {
                name: this.getStringProperty(subValue, 'name', subKey),
                filePath: this.getStringProperty(subValue, 'filePath', key),
                type: this.getStringProperty(subValue, 'type', 'function'),
                score: this.getNumberProperty(subValue, 'score', 0)
              };
              
              if (entry.name && entry.filePath) {
                result.push(entry);
              }
            }
          });
        }
      }
    });
    
    return result;
  },
  
  /**
   * Gets a string property from an object with fallback
   * @param obj - The object to get property from
   * @param prop - The property name
   * @param fallback - Fallback value if property is not a string
   * @returns The property value as string
   */
  getStringProperty(obj: Record<string, any>, prop: string, fallback: string): string {
    return prop in obj && typeof obj[prop] === 'string' ? obj[prop] : fallback;
  },
  
  /**
   * Gets a number property from an object with fallback
   * @param obj - The object to get property from
   * @param prop - The property name
   * @param fallback - Fallback value if property is not a number
   * @returns The property value as number
   */
  getNumberProperty(obj: Record<string, any>, prop: string, fallback: number): number {
    return prop in obj && typeof obj[prop] === 'number' ? obj[prop] : fallback;
  },

  /**
   * Merges symbol index with duplicate analysis scores
   * @param symbolIndex - The symbol index
   * @param duplicateAnalysis - The duplicate analysis data
   * @returns The merged symbol index with scores
   */
  mergeJsonData(
    symbolIndex: SymbolIndex, 
    duplicateAnalysis: DuplicateAnalysisEntry[]
  ): SymbolIndexWithScores {
    // Check if duplicateAnalysis is valid
    if (!Array.isArray(duplicateAnalysis)) {
      console.warn('Duplicate analysis data is not an array, converting to empty array');
      duplicateAnalysis = [];
    }
    
    // Create lookup map for duplicate analysis data by name, filePath, and type
    const duplicateMap = new Map<string, DuplicateAnalysisEntry>();
    
    duplicateAnalysis.forEach(entry => {
      if (entry && typeof entry === 'object' && 'name' in entry && 'filePath' in entry) {
        const key = `${entry.name}|${entry.filePath}|${entry.type || ''}`;
        duplicateMap.set(key, entry);
      }
    });
    
    // Create a new object with the merged data
    const mergedIndex: SymbolIndexWithScores = {};
    
    // Process each file in the symbol index
    Object.entries(symbolIndex).forEach(([filePath, entries]) => {
      // Create a new array for the merged entries
      mergedIndex[filePath] = entries.map(entry => {
        // Look for matching duplicate analysis entry
        const key = `${entry.name}|${entry.filePath}|${entry.type}`;
        const duplicateEntry = duplicateMap.get(key);
        
        // Create the merged entry
        const mergedEntry: SymbolIndexEntryWithScores = {
          ...entry,
          scores: []
        };
        
        // Add score if available
        if (duplicateEntry && typeof duplicateEntry.score === 'number') {
          mergedEntry.scores.push({
            type: 'duplicateAnalysis',
            score: duplicateEntry.score
          });
        }
        
        return mergedEntry;
      });
    });
    
    return mergedIndex;
  },

  /**
   * Writes the merged JSON to disk
   * @param mergedJsonPath - Path to write the merged JSON
   * @param mergedJson - The merged JSON data
   */
  async writeMergedJson(mergedJsonPath: string, mergedJson: SymbolIndexWithScores): Promise<void> {
    try {
      await fs.writeJson(mergedJsonPath, mergedJson, { spaces: 2 });
      console.log(`Merged JSON written to ${mergedJsonPath}`);
    } catch (error) {
      console.error('Error writing merged JSON:', error);
      throw error;
    }
  },

  /**
   * Performs the complete merge operation
   * @param rootPath - The workspace root path
   * @returns The path to the merged JSON file
   */
  async mergeJsonFiles(rootPath: string): Promise<string> {
    const { symbolIndexPath, duplicateAnalysisPath, mergedJsonPath } = this.getFilePaths(rootPath);
    
    // Read the input files
    const symbolIndex = await this.readSymbolIndex(symbolIndexPath);
    const duplicateAnalysis = await this.readDuplicateAnalysis(duplicateAnalysisPath);
    
    // Merge the data
    const mergedJson = this.mergeJsonData(symbolIndex, duplicateAnalysis);
    
    // Write the merged result
    await this.writeMergedJson(mergedJsonPath, mergedJson);
    
    return mergedJsonPath;
  }
}; 