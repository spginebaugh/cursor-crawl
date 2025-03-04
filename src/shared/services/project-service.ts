import * as vscode from 'vscode';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { FileSystemService, execAsync } from '@/shared/services/file-system-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { OpenAiService } from '@/shared/services/openai-service';

/**
 * Project initialization result type
 */
export interface ProjectInitResult {
  rootPath: string;
  cursorCrawlDir: string;
  ignoredPatterns: string[];
  openAiKey?: string;
}

/**
 * Service for project-wide operations
 */
export const ProjectService = {
  /**
   * Initializes the project workspace
   * @param options - Initialization options
   * @returns Project initialization result
   */
  async initializeWorkspace({
    checkOpenAi = false,
    requireOpenAi = false,
    validateSymbolIndex = false,
  }: {
    checkOpenAi?: boolean;
    requireOpenAi?: boolean; 
    validateSymbolIndex?: boolean;
  } = {}): Promise<ProjectInitResult> {
    // Get the workspace folder
    const rootPath = WorkspaceService.getWorkspaceFolder();
    if (!rootPath) {
      throw new Error('No workspace folder found. Please open a folder first.');
    }

    // Ensure the .cursorcrawl directory exists
    const cursorCrawlDir = await WorkspaceService.ensureCursorCrawlDir(rootPath);

    // Parse .gitignore patterns
    const ignoredPatterns = await FileSystemService.parseGitignore(rootPath);

    // Initialize result object
    const result: ProjectInitResult = {
      rootPath,
      cursorCrawlDir,
      ignoredPatterns,
    };

    // Check for OpenAI API key if requested
    if (checkOpenAi) {
      const envVars = OpenAiService.loadEnvironmentVars(rootPath);
      result.openAiKey = envVars.OPENAI_API_KEY;

      if (requireOpenAi && !result.openAiKey) {
        // Handle missing OpenAI key
        const setKey = await vscode.window.showErrorMessage(
          'OpenAI API key not found. Would you like to set it now?',
          'Yes', 'No'
        );
        
        if (setKey === 'Yes') {
          const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API Key',
            password: true,
            ignoreFocusOut: true
          });
          
          if (apiKey) {
            await vscode.workspace.getConfiguration('cursorcrawl').update(
              'openaiApiKey',
              apiKey,
              vscode.ConfigurationTarget.Global
            );
            result.openAiKey = apiKey;
          } else if (requireOpenAi) {
            throw new Error('OpenAI API key is required but was not provided');
          }
        } else if (requireOpenAi) {
          throw new Error('OpenAI API key is required but was not provided');
        }
      }
    }

    // Validate symbol index if requested
    if (validateSymbolIndex) {
      const symbolIndexExists = await SymbolIndexService.symbolIndexExists(rootPath);
      
      if (!symbolIndexExists) {
        const response = await vscode.window.showErrorMessage(
          'Symbol index not found. Would you like to build the symbol index first?',
          'Yes', 'No'
        );
        
        if (response === 'Yes') {
          // Run build symbol index first
          await vscode.commands.executeCommand('cursorcrawl.buildSymbolIndex');
        } else {
          throw new Error('Symbol index is required but does not exist');
        }
      }
    }

    return result;
  },

  /**
   * Generates a project tree respecting .gitignore rules
   * @param rootPath - The workspace root path
   * @param ignoredPatterns - Patterns to ignore
   * @returns Tree content as a string
   */
  async generateProjectTree(rootPath: string, ignoredPatterns: string[]): Promise<string> {
    try {
      // Use git ls-files to get a list of files not ignored by gitignore
      const { stdout } = await execAsync('git ls-files', { cwd: rootPath });
      const files = stdout.split('\n').filter(Boolean);
      
      // Build the tree structure
      const tree = FileSystemService.buildTreeFromPaths(files);
      return FileSystemService.formatTree(tree);
    } catch (error) {
      console.error('Error using git ls-files, using fallback method:', error);
      
      // Get all project files
      const projectFiles = await FileSystemService.getProjectFiles(rootPath, ignoredPatterns);
      
      // Convert to relative paths
      const relativePaths = projectFiles.map(file => 
        FileSystemService.normalizeFilePath(file, rootPath)
      );
      
      // Build and format the tree
      const tree = FileSystemService.buildTreeFromPaths(relativePaths);
      return FileSystemService.formatTree(tree);
    }
  }
}; 