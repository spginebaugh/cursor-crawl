import * as ts from 'typescript';

/**
 * Service for TypeScript analysis operations
 */
export const TsAnalyzerService = {
  /**
   * Computes the line starts for a source file
   * @param text - The source file text
   * @returns Array of line start positions
   */
  computeLineStarts(text: string): number[] {
    const result: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        result.push(i + 1);
      }
    }
    return result;
  },

  /**
   * Gets the line number for a given position in a source file
   * @param sourceFile - The TypeScript source file
   * @param position - The position in the source file
   * @returns The line number (1-indexed)
   */
  getLineNumber(sourceFile: ts.SourceFile, position: number): number {
    const lineStarts = sourceFile.getLineStarts();
    let lineNumber = 0;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > position) {
        break;
      }
      lineNumber = i;
    }
    return lineNumber + 1; // Convert to 1-indexed
  },

  /**
   * Gets the line and character for a given position in a source file
   * @param sourceFile - The TypeScript source file
   * @param node - The TypeScript node
   * @returns The line and character position
   */
  getLineAndCharacter(
    sourceFile: ts.SourceFile, 
    node: ts.Node
  ): { line: number; character: number } {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return { line: line + 1, character }; // Convert to 1-indexed
  },

  /**
   * Creates a TypeScript program for a file
   * @param filePath - The file path
   * @returns The TypeScript program and source file
   */
  createTsProgram(
    filePath: string
  ): { program: ts.Program; sourceFile: ts.SourceFile } {
    // Create a program from the file
    const program = ts.createProgram([filePath], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      allowJs: true,
      checkJs: false,
    });
    
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Could not get source file for ${filePath}`);
    }
    
    return { program, sourceFile };
  },

  /**
   * Extracts a code snippet from a node
   * @param sourceFile - The TypeScript source file
   * @param node - The TypeScript node
   * @returns The code snippet
   */
  extractCodeSnippet(sourceFile: ts.SourceFile, node: ts.Node): string {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    return sourceFile.text.substring(start, end);
  },

  /**
   * Gets a context snippet around a position
   * @param sourceFile - The TypeScript source file
   * @param position - The position in the source file
   * @param contextLines - The number of context lines before and after
   * @returns The context snippet
   */
  getContextSnippet(
    sourceFile: ts.SourceFile, 
    position: number, 
    contextLines: number = 3
  ): string {
    const lineStarts = sourceFile.getLineStarts();
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    
    const startLine = Math.max(0, line - contextLines);
    const endLine = Math.min(lineStarts.length - 1, line + contextLines);
    
    const startPos = lineStarts[startLine];
    const endPos = endLine < lineStarts.length - 1 
      ? lineStarts[endLine + 1] - 1 // Exclude newline
      : sourceFile.text.length;
    
    return sourceFile.text.substring(startPos, endPos);
  },

  /**
   * Compares two arrays to see if they have the same items
   * @param arr1 - First array
   * @param arr2 - Second array
   * @returns Whether the arrays have the same items
   */
  arraysHaveSameItems<T>(arr1: T[], arr2: T[]): boolean {
    if (arr1.length !== arr2.length) {
      return false;
    }
    
    const set = new Set(arr1);
    return arr2.every(item => set.has(item));
  }
}; 