/**
 * Structure for holding docstring information
 */
export interface DocstringInfo {
  /**
   * Name of the function, class, interface, etc.
   */
  name: string;
  
  /**
   * Path to the file containing the element
   */
  filePath: string;
  
  /**
   * The generated docstring
   */
  docstring: string;
  
  /**
   * Type of the element
   */
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'other';
  
  /**
   * Original code snippet
   */
  snippet: string;
  
  /**
   * Location in the file
   */
  location: {
    line: number;
    character: number;
  };
}

/**
 * Structure for the docstring index
 * Key is the file path, value is an array of docstring info objects
 */
export interface DocstringIndex {
  /**
   * Map of file paths to docstring info arrays
   */
  [filePath: string]: DocstringInfo[];
} 