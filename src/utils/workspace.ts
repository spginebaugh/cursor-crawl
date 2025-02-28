import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Gets the current workspace folder
 * @returns The workspace folder path or undefined if no workspace is open
 */
export const getWorkspaceFolder = (): string | undefined => {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }
  return workspaceFolders[0].uri.fsPath;
};

/**
 * Ensures the .cursortest directory exists in the workspace
 * @param rootPath - The workspace root path
 * @returns The path to the .cursortest directory
 */
export const ensureCursorTestDir = async (rootPath: string): Promise<string> => {
  const cursorTestDir = path.join(rootPath, '.cursortest');
  await fs.ensureDir(cursorTestDir);
  return cursorTestDir;
};

/**
 * Writes data to a file in the .cursortest directory
 * @param rootPath - The workspace root path
 * @param filename - The name of the file to write
 * @param data - The data to write
 * @returns The path to the written file
 */
export const writeCursorTestFile = async (
  rootPath: string,
  filename: string,
  data: any
): Promise<string> => {
  const cursorTestDir = await ensureCursorTestDir(rootPath);
  const filePath = path.join(cursorTestDir, filename);
  
  if (typeof data === 'string') {
    await fs.writeFile(filePath, data, 'utf8');
  } else {
    await fs.writeJson(filePath, data, { spaces: 2 });
  }
  
  return filePath;
};

/**
 * Reads data from a file in the .cursortest directory
 * @param rootPath - The workspace root path
 * @param filename - The name of the file to read
 * @param isJson - Whether the file contains JSON data
 * @returns The file data
 */
export const readCursorTestFile = async <T>(
  rootPath: string,
  filename: string,
  isJson: boolean = true
): Promise<T> => {
  const filePath = path.join(rootPath, '.cursortest', filename);
  
  if (!await fs.pathExists(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  if (isJson) {
    return await fs.readJson(filePath);
  } else {
    return await fs.readFile(filePath, 'utf8') as unknown as T;
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