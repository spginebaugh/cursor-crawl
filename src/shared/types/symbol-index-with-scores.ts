import { SymbolIndex, SymbolIndexEntry } from '@/shared/types/symbol-index';

/**
 * Represents score information for a symbol
 */
export interface ScoreInfo {
  /**
   * Type of the score (e.g., "duplicateAnalysis")
   */
  type: string;
  
  /**
   * Score value
   */
  score: number;
}

/**
 * Extends SymbolIndexEntry with scores information
 */
export interface SymbolIndexEntryWithScores extends SymbolIndexEntry {
  /**
   * Array of scores associated with this symbol
   */
  scores: ScoreInfo[];
}

/**
 * The complete symbol index structure with scores
 * Organized by file path for easier lookup
 */
export interface SymbolIndexWithScores {
  /**
   * Map of file paths to arrays of symbol entries with scores
   */
  [filePath: string]: SymbolIndexEntryWithScores[];
} 