import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';

// Constants
const CURSOR_TEST_DIR = '.cursortest';

/**
 * Service for handling workspace-related operations
 */
export const WorkspaceService = {
  /**
   * Gets the current workspace folder
   * @returns The workspace folder path or undefined if no workspace is open
   */
  getWorkspaceFolder(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0].uri.fsPath;
  },

  /**
   * Gets the current workspace folder or throws an error if none is open
   * @returns The workspace folder path
   * @throws Error if no workspace folder is open
   */
  getWorkspaceFolderOrThrow(): string {
    const workspaceFolder = this.getWorkspaceFolder();
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }
    return workspaceFolder;
  },

  /**
   * Ensures the .cursortest directory exists in the workspace
   * @param rootPath - The workspace root path
   * @returns The path to the .cursortest directory
   */
  async ensureCursorTestDir(rootPath: string): Promise<string> {
    const cursorTestDir = path.join(rootPath, CURSOR_TEST_DIR);
    await fs.ensureDir(cursorTestDir);
    return cursorTestDir;
  },

  /**
   * Gets the path to the .cursortest directory
   * @param rootPath - The workspace root path
   * @returns The path to the .cursortest directory
   */
  getCursorTestDir(rootPath: string): string {
    return path.join(rootPath, CURSOR_TEST_DIR);
  },

  /**
   * Writes data to a file in the .cursortest directory
   * @param rootPath - The workspace root path
   * @param filename - The name of the file to write
   * @param data - The data to write
   * @returns The path to the written file
   */
  async writeCursorTestFile(
    rootPath: string,
    filename: string,
    data: any
  ): Promise<string> {
    const cursorTestDir = await this.ensureCursorTestDir(rootPath);
    const filePath = path.join(cursorTestDir, filename);
    
    if (typeof data === 'string') {
      await fs.writeFile(filePath, data, 'utf8');
    } else {
      await fs.writeJson(filePath, data, { spaces: 2 });
    }
    
    return filePath;
  },

  /**
   * Reads data from a file in the .cursortest directory
   * @param rootPath - The workspace root path
   * @param filename - The name of the file to read
   * @param isJson - Whether the file contains JSON data
   * @returns The file data
   */
  async readCursorTestFile<T>(
    rootPath: string,
    filename: string,
    isJson: boolean = true
  ): Promise<T> {
    const filePath = path.join(rootPath, CURSOR_TEST_DIR, filename);
    
    if (!await fs.pathExists(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    if (isJson) {
      return await fs.readJson(filePath);
    } else {
      return await fs.readFile(filePath, 'utf8') as unknown as T;
    }
  },

  /**
   * Checks if a file exists in the .cursortest directory
   * @param rootPath - The workspace root path
   * @param filename - The name of the file to check
   * @returns Whether the file exists
   */
  async cursorTestFileExists(
    rootPath: string,
    filename: string
  ): Promise<boolean> {
    const filePath = path.join(rootPath, CURSOR_TEST_DIR, filename);
    return fs.pathExists(filePath);
  }
};

/**
 * Shows an information message in VS Code
 * @param message - The message to show
 */
export const showInformationMessage = (message: string): void => {
  vscode.window.showInformationMessage(message);
};

/**
 * Shows an error message in VS Code
 * @param message - The message to show
 * @param error - The error object
 */
export const showErrorMessage = (message: string, error?: any): void => {
  const errorMessage = error instanceof Error ? error.message : String(error || '');
  vscode.window.showErrorMessage(`${message}${errorMessage ? `: ${errorMessage}` : ''}`);
};

/**
 * Shows a warning message in VS Code
 * @param message - The message to show
 */
export const showWarningMessage = (message: string): void => {
  vscode.window.showWarningMessage(message);
}; 