import * as vscode from 'vscode';

/**
 * Interface for the progress callback function
 */
export interface ProgressCallback<T = void> {
  (
    progress: vscode.Progress<{ message?: string }>,
    token?: vscode.CancellationToken
  ): Promise<T>;
}

/**
 * Service for handling progress reporting
 */
export const ProgressService = {
  /**
   * Runs a task with progress reporting
   * @param title - The title of the progress report
   * @param callback - The callback function to execute with progress
   * @param options - Additional options for the progress
   * @returns The result of the callback
   */
  async runWithProgress<T = void>(
    title: string,
    callback: ProgressCallback<T>,
    options: {
      location?: vscode.ProgressLocation;
      cancellable?: boolean;
    } = {}
  ): Promise<T> {
    const {
      location = vscode.ProgressLocation.Notification,
      cancellable = false
    } = options;
    
    return vscode.window.withProgress(
      {
        location,
        title,
        cancellable
      },
      callback
    );
  },
  
  /**
   * Creates a progress reporter function that formats messages consistently
   * @param prefix - A prefix for all progress messages
   * @returns A function that can be used to report progress with consistent formatting
   */
  createReporter(prefix: string = '') {
    return (progress: vscode.Progress<{ message?: string }>, message: string) => {
      progress.report({ message: prefix ? `${prefix}: ${message}` : message });
    };
  },
  
  /**
   * Reports progress on file processing with a consistent format
   * @param progress - The VS Code progress object
   * @param currentFile - The current file being processed
   * @param currentIndex - The index of the current file
   * @param totalFiles - The total number of files
   * @param additionalInfo - Additional information to include in the message
   */
  reportFileProgress(
    progress: vscode.Progress<{ message?: string }>,
    currentFile: string,
    currentIndex: number,
    totalFiles: number,
    additionalInfo?: string
  ): void {
    const message = `Processing file ${currentIndex}/${totalFiles}: ${currentFile}${additionalInfo ? ` (${additionalInfo})` : ''}`;
    progress.report({ message });
  }
}; 