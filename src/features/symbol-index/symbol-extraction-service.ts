import * as fs from 'fs-extra';
import * as ts from 'typescript';
import { SymbolIndexEntry } from '@/shared/types/symbol-index';
import { FileSystemService } from '@/shared/services/file-system-service';
import { TsAnalyzerService } from '@/shared/services/ts-analyzer-service';

// Configuration for symbol extraction
const SYMBOL_EXTRACTION_CONFIG = {
  // Identifiers to exclude from symbol extraction
  excludedIdentifiers: ['console', 'require', 'module', 'exports', 'process'],
  // Size limit for files to analyze (in bytes)
  fileSizeLimit: 1000000, // 1MB
};

// Valid symbol types
type SymbolType = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'enum' | 'other';

/**
 * Service for extracting symbols from TypeScript files
 */
export const SymbolExtractionService = {
  /**
   * Extracts JSDoc comment from a node if present
   * @param node - The TypeScript node
   * @param sourceFile - The source file
   * @returns The JSDoc comment text or empty string
   */
  extractJSDocComment(node: ts.Node, sourceFile: ts.SourceFile): string {
    const jsDocComments = ts.getJSDocCommentsAndTags(node) as ts.JSDoc[];
    
    if (jsDocComments && jsDocComments.length > 0) {
      // Get the first JSDoc comment
      const jsDoc = jsDocComments[0];
      
      // Extract the JSDoc text
      if (jsDoc.getFullText) {
        return jsDoc.getFullText(sourceFile);
      }
    }
    
    return '';
  },

  /**
   * Gets docstring for a node with fallback to empty JSDoc comment
   * @param node - The TypeScript node
   * @param sourceFile - The source file
   * @returns The docstring with fallback
   */
  getDocstringWithFallback(node: ts.Node, sourceFile: ts.SourceFile): string {
    const hasJSDoc = ts.getJSDocTags(node).length > 0;
    return hasJSDoc ? this.extractJSDocComment(node, sourceFile) : '/** */';
  },

  /**
   * Creates a symbol index entry
   * @param params - Parameters for creating the entry
   * @returns A symbol index entry
   */
  createSymbolIndexEntry({
    name,
    type,
    filePath,
    node,
    sourceFile
  }: {
    name: string;
    type: SymbolType;
    filePath: string;
    node: ts.Node;
    sourceFile: ts.SourceFile;
  }): SymbolIndexEntry {
    const location = TsAnalyzerService.getLineAndCharacter(sourceFile, node);
    const snippet = TsAnalyzerService.extractCodeSnippet(sourceFile, node);
    const docstring = this.getDocstringWithFallback(node, sourceFile);

    return {
      name,
      type,
      filePath,
      location,
      docstring,
      snippet,
      dependents: [],
      depends_on: []
    };
  },

  /**
   * Handles function declarations
   * @param node - The function declaration node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Symbol index entry or null
   */
  handleFunctionDeclaration(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry | null {
    if (!node.name) {return null;}
    
    const name = node.name.text;
    if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return null;}

    return this.createSymbolIndexEntry({
      name,
      type: 'function',
      filePath,
      node,
      sourceFile
    });
  },

  /**
   * Handles class declarations
   * @param node - The class declaration node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Array of symbol index entries
   */
  handleClassDeclaration(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry[] {
    if (!node.name) {return [];}
    
    const name = node.name.text;
    if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return [];}

    const symbols: SymbolIndexEntry[] = [
      this.createSymbolIndexEntry({
        name,
        type: 'class',
        filePath,
        node,
        sourceFile
      })
    ];

    // Process class methods
    node.members.forEach(member => {
      if (ts.isMethodDeclaration(member) && member.name) {
        const methodName = member.name.getText(sourceFile);
        
        symbols.push(
          this.createSymbolIndexEntry({
            name: `${name}.${methodName}`,
            type: 'method',
            filePath,
            node: member,
            sourceFile
          })
        );
      }
    });

    return symbols;
  },

  /**
   * Handles interface declarations
   * @param node - The interface declaration node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Symbol index entry or null
   */
  handleInterfaceDeclaration(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry | null {
    if (!node.name) {return null;}
    
    const name = node.name.text;
    if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return null;}

    return this.createSymbolIndexEntry({
      name,
      type: 'interface',
      filePath,
      node,
      sourceFile
    });
  },

  /**
   * Handles type alias declarations
   * @param node - The type alias declaration node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Symbol index entry or null
   */
  handleTypeAliasDeclaration(
    node: ts.TypeAliasDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry | null {
    if (!node.name) {return null;}
    
    const name = node.name.text;
    if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return null;}

    return this.createSymbolIndexEntry({
      name,
      type: 'type',
      filePath,
      node,
      sourceFile
    });
  },

  /**
   * Handles enum declarations
   * @param node - The enum declaration node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Symbol index entry or null
   */
  handleEnumDeclaration(
    node: ts.EnumDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry | null {
    if (!node.name) {return null;}
    
    const name = node.name.text;
    if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return null;}

    return this.createSymbolIndexEntry({
      name,
      type: 'enum',
      filePath,
      node,
      sourceFile
    });
  },

  /**
   * Handles variable statements
   * @param node - The variable statement node
   * @param sourceFile - The source file
   * @param filePath - Normalized file path
   * @returns Array of symbol index entries
   */
  handleVariableStatement(
    node: ts.VariableStatement,
    sourceFile: ts.SourceFile,
    filePath: string
  ): SymbolIndexEntry[] {
    const symbols: SymbolIndexEntry[] = [];

    node.declarationList.declarations.forEach(declaration => {
      if (ts.isIdentifier(declaration.name)) {
        const name = declaration.name.text;
        
        if (SYMBOL_EXTRACTION_CONFIG.excludedIdentifiers.includes(name)) {return;}

        symbols.push(
          this.createSymbolIndexEntry({
            name,
            type: 'variable',
            filePath,
            node: declaration,
            sourceFile
          })
        );
      }
    });

    return symbols;
  },

  /**
   * Extracts symbols from a file
   * @param filePath - Path to the file
   * @param normalizedPath - Normalized file path relative to project root
   * @param rootPath - Project root path
   * @returns Array of symbol entries
   */
  async extractSymbols(
    filePath: string,
    normalizedPath: string,
    rootPath: string
  ): Promise<SymbolIndexEntry[]> {
    try {
      // Skip non-analyzable files
      if (!FileSystemService.isAnalyzableFile(filePath)) {
        return [];
      }
      
      // Read the file content
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      // Skip files that are too large
      if (fileContent.length > SYMBOL_EXTRACTION_CONFIG.fileSizeLimit) {
        console.log(`Skipping large file: ${filePath} (${Math.round(fileContent.length/1024)}KB)`);
        return [];
      }
      
      // Create a TypeScript source file
      const sourceFile = ts.createSourceFile(
        filePath,
        fileContent,
        ts.ScriptTarget.Latest,
        true
      );
      
      const symbols: SymbolIndexEntry[] = [];
      
      // Recursively visit nodes to extract symbols
      const visit = (node: ts.Node) => {
        try {
          let nodeSymbols: SymbolIndexEntry | SymbolIndexEntry[] | null = null;
          
          // Dispatch to appropriate handler based on node kind
          if (ts.isFunctionDeclaration(node)) {
            nodeSymbols = this.handleFunctionDeclaration(node, sourceFile, normalizedPath);
          } else if (ts.isClassDeclaration(node)) {
            nodeSymbols = this.handleClassDeclaration(node, sourceFile, normalizedPath);
          } else if (ts.isInterfaceDeclaration(node)) {
            nodeSymbols = this.handleInterfaceDeclaration(node, sourceFile, normalizedPath);
          } else if (ts.isTypeAliasDeclaration(node)) {
            nodeSymbols = this.handleTypeAliasDeclaration(node, sourceFile, normalizedPath);
          } else if (ts.isEnumDeclaration(node)) {
            nodeSymbols = this.handleEnumDeclaration(node, sourceFile, normalizedPath);
          } else if (ts.isVariableStatement(node)) {
            nodeSymbols = this.handleVariableStatement(node, sourceFile, normalizedPath);
          }
          
          // Add the extracted symbols to the result
          if (nodeSymbols) {
            if (Array.isArray(nodeSymbols)) {
              symbols.push(...nodeSymbols);
            } else {
              symbols.push(nodeSymbols);
            }
          }
          
          // Process child nodes
          ts.forEachChild(node, visit);
        } catch (error) {
          console.error(`Error processing node in ${filePath}:`, error);
        }
      };
      
      // Start the traversal
      visit(sourceFile);
      
      return symbols;
    } catch (error) {
      console.error(`Error extracting symbols from ${filePath}:`, error);
      return [];
    }
  }
};