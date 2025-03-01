import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import { MergeJsonService } from '@/features/merge-json/merge-json-service';
import { WorkspaceService } from '@/shared/services/workspace-service';

/**
 * Handles execution of the merge JSON for visualization command
 * @returns A function that handles the command
 */
export const mergeJsonForVisualizationCommand = (): vscode.Disposable => {
  return vscode.commands.registerCommand('cursorcrawl.mergeJsonForVisualization', async () => {
    try {
      const rootPath = WorkspaceService.getWorkspaceFolder();
      
      if (!rootPath) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
      }
      
      // Show progress indicator
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Merging JSON files...',
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Processing files...' });
          
          try {
            // Check if required files exist
            const { symbolIndexPath, duplicateAnalysisPath } = MergeJsonService.getFilePaths(rootPath);
            
            const symbolIndexExists = await fs.pathExists(symbolIndexPath);
            const duplicateAnalysisExists = await fs.pathExists(duplicateAnalysisPath);
            
            if (!symbolIndexExists) {
              throw new Error('Symbol index file not found. Please run "Build Symbol Index" command first.');
            }
            
            if (!duplicateAnalysisExists) {
              throw new Error('Duplicate analysis file not found. Please run "Analyze Duplicate Logic" command first.');
            }
            
            try {
              progress.report({ message: 'Reading input files...' });
              
              // Preview the file sizes and basic structure
              const symbolIndexStats = await fs.stat(symbolIndexPath);
              const duplicateAnalysisStats = await fs.stat(duplicateAnalysisPath);
              
              console.log(`Symbol index file size: ${symbolIndexStats.size} bytes`);
              console.log(`Duplicate analysis file size: ${duplicateAnalysisStats.size} bytes`);
              
              // Merge the files
              progress.report({ message: 'Merging data...' });
              const mergedJsonPath = await MergeJsonService.mergeJsonFiles(rootPath);
              
              vscode.window.showInformationMessage(
                `Successfully merged JSON files. Output saved to ${mergedJsonPath}`,
                'Open File'
              ).then(selection => {
                if (selection === 'Open File') {
                  vscode.commands.executeCommand('vscode.open', vscode.Uri.file(mergedJsonPath));
                }
              });
            } catch (mergeError) {
              console.error('Error during merge operation:', mergeError);
              
              // Check if the error is due to file format issues
              if (mergeError instanceof Error && 
                  (mergeError.message.includes('not a function') || 
                   mergeError.message.includes('is not iterable') ||
                   mergeError.message.includes('JSON'))) {
                
                vscode.window.showErrorMessage(
                  `Failed to merge JSON files: The format of the duplicate analysis file is not as expected. ` +
                  `Error: ${mergeError.message}`,
                  'View File'
                ).then(selection => {
                  if (selection === 'View File') {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(duplicateAnalysisPath));
                  }
                });
              } else {
                throw mergeError; // Re-throw for general error handling
              }
            }
          } catch (error) {
            console.error('Error in merge JSON command:', error);
            vscode.window.showErrorMessage(`Failed to merge JSON files: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      );
    } catch (error) {
      console.error('Error in merge JSON command (outer):', error);
      vscode.window.showErrorMessage(`Error merging JSON files: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}; 