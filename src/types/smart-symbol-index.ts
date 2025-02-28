/**
 * The complete smart symbol index for a project
 */
export interface SmartSymbolIndex {
  /**
   * Map of symbol identifiers to their detailed information
   */
  symbols: Record<string, SymbolInfo>;
}

/**
 * Represents a symbol in the codebase (function, class, interface, etc.)
 */
export interface SymbolInfo {
  /**
   * Name of the symbol
   */
  name: string;
  
  /**
   * Type of the symbol (function, class, interface, etc.)
   */
  type: SymbolType;
  
  /**
   * File path where the symbol is defined, relative to project root
   */
  file: string;
  
  /**
   * Line number where the symbol is defined
   */
  defined_at: string;
  
  /**
   * Description of the symbol (will be filled by AI in the next step)
   */
  description: string;
  
  /**
   * Function/method parameters (for function-like symbols)
   */
  parameters?: ParameterInfo[];
  
  /**
   * Return type information (for function-like symbols)
   */
  return?: ReturnTypeInfo;
  
  /**
   * References to this symbol from other files/symbols
   */
  references: Record<string, ReferenceInfo>;
  
  /**
   * Symbols that this symbol calls or references
   */
  calls: CallInfo[];
}

/**
 * Types of symbols that can be indexed
 */
export type SymbolType = 
  | 'function' 
  | 'class' 
  | 'interface' 
  | 'type' 
  | 'enum' 
  | 'variable'
  | 'namespace'
  | 'property'
  | 'method';

/**
 * Information about a parameter in a function or method
 */
export interface ParameterInfo {
  /**
   * Name of the parameter
   */
  name: string;
  
  /**
   * Type of the parameter
   */
  type: string;
  
  /**
   * Description of the parameter (will be filled by AI in the next step)
   */
  description: string;
}

/**
 * Information about a function or method's return type
 */
export interface ReturnTypeInfo {
  /**
   * The return type
   */
  type: string;
  
  /**
   * Description of the return value (will be filled by AI in the next step)
   */
  description: string;
}

/**
 * Information about references to a symbol
 */
export interface ReferenceInfo {
  /**
   * Symbols that call or reference this symbol
   */
  callers: CallerInfo[];
}

/**
 * Information about a specific caller of a symbol
 */
export interface CallerInfo {
  /**
   * Name of the symbol making the call
   */
  symbolName: string;
  
  /**
   * Line number where the call occurs
   */
  line: number;
  
  /**
   * Code snippet showing the context of the call
   */
  contextSnippet: string;
}

/**
 * Information about a symbol call
 */
export interface CallInfo {
  /**
   * Name of the symbol being called
   */
  symbolName: string;
  
  /**
   * Line number where the call occurs
   */
  line: number;
} 