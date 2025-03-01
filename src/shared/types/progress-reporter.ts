import * as vscode from 'vscode';

/**
 * Interface for a progress reporter that can be used across different contexts
 */
export interface ProgressReporter {
  /**
   * Reports progress with a message
   * @param info - The progress information to report
   */
  report: (info: { message: string }) => void;
  
  /**
   * Checks if the operation has been cancelled
   * @returns True if the operation has been cancelled, false otherwise
   */
  isCancelled?: () => boolean;
}

/**
 * Type for a VSCode progress object that can be used as a ProgressReporter
 */
export type VSCodeProgressReporter = vscode.Progress<{ message?: string }>;

/**
 * Creates a null progress reporter that does nothing
 * @returns A progress reporter that does nothing
 */
export const createNullProgressReporter = (): ProgressReporter => ({
  report: () => {},
  isCancelled: () => false
});

/**
 * Adapts a VSCode progress reporter to match the ProgressReporter interface
 * @param vscodeProgress - The VSCode progress reporter to adapt
 * @param token - Optional cancellation token for the operation
 * @returns A progress reporter that forwards to the VSCode progress reporter
 */
export const adaptVSCodeProgress = (
  vscodeProgress: VSCodeProgressReporter, 
  token?: vscode.CancellationToken
): ProgressReporter => ({
  report: (info: { message: string }) => vscodeProgress.report({ message: info.message }),
  isCancelled: token ? () => token.isCancellationRequested : undefined
}); 