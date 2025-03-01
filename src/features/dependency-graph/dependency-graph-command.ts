import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { DependencyGraphService } from '@/features/dependency-graph/dependency-graph-service';
import { WorkspaceService } from '@/shared/services/workspace-service';

/**
 * Handles execution of the dependency graph visualization command
 * @returns A function that handles the command
 */
export const showDependencyGraphCommand = (): vscode.Disposable => {
  return vscode.commands.registerCommand('cursorcrawl.showDependencyGraph', async () => {
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
          title: 'Generating dependency graph...',
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Processing symbol index...' });
          
          try {
            // Generate the visualization
            const visualizationPath = await DependencyGraphService.generateVisualization(rootPath);
            
            // Show the visualization in the browser
            const uri = vscode.Uri.file(visualizationPath);
            await vscode.env.openExternal(uri);
            
            vscode.window.showInformationMessage('Dependency graph visualization opened in browser.');
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate dependency graph: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Error showing dependency graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}; 