// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createDependencyMap, updateDependencyMap } from './dependency-mapper';
import { createSmartSymbolIndex, updateSmartSymbolIndex } from './smart-symbol-index';
import { DependencyMap } from './types/dependency-map';
import { SmartSymbolIndex } from './types/smart-symbol-index';
import { extractContextFiles, generateRelevantInfo } from './context-extractor';
import { generateDocstringIndex } from './docstring-generator';
import { 
	parseGitignore, 
	buildTreeFromPaths, 
	formatTree, 
	execAsync 
} from './utils/file-system';
import {
	getWorkspaceFolder,
	ensureCursorTestDir,
	writeCursorTestFile,
	showInformationMessage,
	showErrorMessage
} from './utils/workspace';
import { loadEnvironmentVars } from './utils/openai';

// Function to generate a project tree respecting .gitignore rules
const generateProjectTree = async (rootPath: string, ignoredPatterns: string[]): Promise<string> => {
	try {
		// Use git ls-files to get a list of files not ignored by gitignore
		// If git is not available, this will throw an error and we'll use a fallback
		const { stdout } = await execAsync('git ls-files', { cwd: rootPath });
		const files = stdout.split('\n').filter(Boolean);
		
		// Build the tree structure
		const tree = buildTreeFromPaths(files);
		return formatTree(tree);
	} catch (error) {
		console.error('Error using git ls-files, using fallback method:', error);
		
		// Fallback: manually traverse the directory
		const tree = await traverseDirectory(rootPath, '', ignoredPatterns);
		return formatTree(tree);
	}
};

// Function to traverse directory and build a tree structure (fallback method)
const traverseDirectory = async (
	rootPath: string, 
	relativePath: string = '', 
	ignoredPatterns: string[]
): Promise<Record<string, any>> => {
	const currentPath = path.join(rootPath, relativePath);
	const tree: Record<string, any> = {};
	
	const isIgnored = (itemPath: string): boolean => {
		const relPath = path.relative(rootPath, itemPath);
		return ignoredPatterns.some(pattern => {
			// Simple pattern matching (can be enhanced for more complex gitignore rules)
			if (pattern.endsWith('/')) {
				// Directory pattern
				return relPath.startsWith(pattern) || relPath.includes(`/${pattern}`);
			}
			// File pattern
			return relPath === pattern || relPath.endsWith(`/${pattern}`) || 
				   // Handle wildcard patterns like *.vsix
				   (pattern.startsWith('*') && relPath.endsWith(pattern.substring(1)));
		});
	};
	
	try {
		const items = await fs.readdir(currentPath);
		
		for (const item of items) {
			const itemPath = path.join(currentPath, item);
			const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
			
			if (isIgnored(itemPath)) {
				continue;
			}
			
			const stats = await fs.stat(itemPath);
			
			if (stats.isDirectory()) {
				tree[item] = await traverseDirectory(rootPath, itemRelativePath, ignoredPatterns);
			} else {
				tree[item] = null; // null indicates it's a file
			}
		}
		
		return tree;
	} catch (error) {
		console.error(`Error traversing directory ${currentPath}:`, error);
		return {};
	}
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "cursorcrawl" is now active!');

	// Register the analyze command
	const analyzeCommand = vscode.commands.registerCommand('cursorcrawl.analyze', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			showErrorMessage('No workspace folder found. Please open a folder first.');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		
		try {
			// Create .cursortest directory if it doesn't exist
			await ensureCursorTestDir(rootPath);
			
			// Parse .gitignore
			const ignoredPatterns = await parseGitignore(rootPath);
			
			// Generate project tree
			const treeContent = await generateProjectTree(rootPath, ignoredPatterns);
			
			// Write project tree to file
			await writeCursorTestFile(rootPath, 'project-tree.mdc', `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`);
			
			// Generate dependency map
			const dependencyMap = await createDependencyMap(rootPath, ignoredPatterns);
			
			// Generate smart symbol index
			await createSmartSymbolIndex(rootPath, ignoredPatterns);
			
			showInformationMessage('Project analysis completed successfully!');
		} catch (error) {
			console.error('Error generating project tree and dependency map:', error);
			showErrorMessage('Error generating project analysis', error);
		}
	});

	// Register the build symbol index command
	const buildSymbolIndexCommand = vscode.commands.registerCommand('cursorcrawl.buildSymbolIndex', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			showErrorMessage('No workspace folder open.');
			return;
		}
		
		const rootPath = workspaceFolders[0].uri.fsPath;
		
		// Get ignored patterns from .gitignore
		const ignoredPatterns = await parseGitignore(rootPath);
		
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Building Smart Symbol Index',
			cancellable: false
		}, async (progress) => {
			try {
				progress.report({ message: 'Analyzing project structure...' });
				
				// Create the smart symbol index
				await createSmartSymbolIndex(rootPath, ignoredPatterns);
				
				showInformationMessage('Smart Symbol Index built successfully.');
			} catch (error) {
				console.error('Error building smart symbol index:', error);
				showErrorMessage('Error building smart symbol index', error);
			}
		});
	});

	// Register the generate docstring index command
	const generateDocstringIndexCommand = vscode.commands.registerCommand('cursorcrawl.generateDocstringIndex', async () => {
		const workspaceFolder = getWorkspaceFolder();
		if (!workspaceFolder) {
			showErrorMessage('No workspace folder open.');
			return;
		}
		
		// Load environment variables
		const envVars = loadEnvironmentVars(workspaceFolder);
		if (!envVars.OPENAI_API_KEY) {
			showErrorMessage('OpenAI API key not found. Please set it in .env.local or in settings.');
			return;
		}
		
		// Get ignored patterns from .gitignore
		const ignoredPatterns = await parseGitignore(workspaceFolder);
		
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating Docstring Index',
			cancellable: false
		}, async (progress) => {
			try {
				// Initial status message is now set inside the generateDocstringIndex function
				
				// Generate the docstring index - pass the progress object
				await generateDocstringIndex(workspaceFolder, ignoredPatterns, progress);
				
				showInformationMessage('Docstring Index generated successfully.');
			} catch (error) {
				console.error('Error generating docstring index:', error);
				showErrorMessage('Error generating docstring index', error);
			}
		});
	});

	// Register the extract context command
	const extractContextCommand = vscode.commands.registerCommand('cursorcrawl.extractContext', async () => {
		const workspaceFolder = getWorkspaceFolder();
		if (!workspaceFolder) {
			showErrorMessage('No workspace folder found. Please open a folder first.');
			return;
		}

		// Check if dependency map and symbol index exist
		const cursorTestDir = path.join(workspaceFolder, '.cursortest');
		const dependencyMapPath = path.join(cursorTestDir, 'dependency-map.json');
		const symbolIndexPath = path.join(cursorTestDir, 'smart-symbol-index.json');
		
		if (!await fs.pathExists(dependencyMapPath) || !await fs.pathExists(symbolIndexPath)) {
			const response = await vscode.window.showErrorMessage(
				'Dependency map or symbol index not found. Would you like to run analysis first?',
				'Yes', 'No'
			);
			
			if (response === 'Yes') {
				// Run analysis first
				await vscode.commands.executeCommand('cursorcrawl.analyze');
			} else {
				return;
			}
		}
		
		// Show input box for the prompt
		const promptText = await vscode.window.showInputBox({
			placeHolder: 'Enter your prompt with file references using @filename.ts syntax',
			prompt: 'Files referenced with @ will be included as context',
			ignoreFocusOut: true
		});
		
		if (!promptText) {
			return; // User cancelled
		}
		
		try {
			// Show progress indicator
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Extracting Context Information",
					cancellable: false
				},
				async (progress) => {
					progress.report({ message: "Identifying referenced files..." });
					
					// Extract context files from the prompt
					const contextFiles = extractContextFiles(promptText);
					
					if (contextFiles.length === 0) {
						showInformationMessage('No file references found in prompt. Please use @filename.ts syntax to reference files.');
						return;
					}
					
					progress.report({ message: `Found ${contextFiles.length} referenced files. Generating relevant information...` });
					
					// Generate the relevant-info.json file
					await generateRelevantInfo(workspaceFolder, contextFiles);
					
					progress.report({ message: "Context information extracted successfully!" });
					
					// Show the relevant files that were found
					showInformationMessage(
						`Successfully extracted context for ${contextFiles.length} files: ${contextFiles.slice(0, 3).join(', ')}${contextFiles.length > 3 ? '...' : ''}`
					);
					
					// Open the relevant-info.json file in the editor
					const relevantInfoPath = path.join(cursorTestDir, 'relevant-info.json');
					const document = await vscode.workspace.openTextDocument(relevantInfoPath);
					await vscode.window.showTextDocument(document);
				}
			);
		} catch (error) {
			console.error('Error extracting context information:', error);
			showErrorMessage('Error extracting context information', error);
		}
	});

	// Set up file system watcher
	const setupFileWatcher = () => {
		const workspaceFolder = getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
		
		// Shared dependency map state for incremental updates
		let dependencyMapCache: DependencyMap | null = null;
		// Shared symbol index state for incremental updates
		let symbolIndexCache: SmartSymbolIndex | null = null;
		
		// Debounce to avoid too many updates
		let debounceTimer: NodeJS.Timeout | null = null;
		const updateProjectAnalysis = async (changedFile?: string) => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			
			debounceTimer = setTimeout(async () => {
				try {
					// Create .cursortest directory if it doesn't exist
					await ensureCursorTestDir(workspaceFolder);
					
					// Parse .gitignore
					const ignoredPatterns = await parseGitignore(workspaceFolder);
					
					// Generate project tree
					const treeContent = await generateProjectTree(workspaceFolder, ignoredPatterns);
					
					// Write project tree to file
					await writeCursorTestFile(workspaceFolder, 'project-tree.mdc', `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`);
					
					// Update dependency map
					// If we have a dependency map cache and a specific file changed, do incremental update
					if (dependencyMapCache && changedFile) {
						dependencyMapCache = await updateDependencyMap(
							workspaceFolder, 
							dependencyMapCache, 
							changedFile,
							ignoredPatterns
						);
					} else {
						// Otherwise do a full rebuild
						dependencyMapCache = await createDependencyMap(workspaceFolder, ignoredPatterns);
					}
					
					// Update smart symbol index
					// If we have a symbol index cache and a specific file changed, do incremental update
					if (symbolIndexCache && changedFile) {
						symbolIndexCache = await updateSmartSymbolIndex(
							workspaceFolder,
							symbolIndexCache,
							changedFile,
							ignoredPatterns
						);
					} else {
						// Otherwise do a full rebuild
						symbolIndexCache = await createSmartSymbolIndex(workspaceFolder, ignoredPatterns);
					}
					
					console.log('Project analysis updated automatically.');
				} catch (error) {
					console.error('Error updating project analysis:', error);
				}
			}, 1000); // Wait 1 second after the last change
		};
		
		// Watch for file changes
		watcher.onDidCreate((uri) => updateProjectAnalysis(uri.fsPath));
		watcher.onDidChange((uri) => updateProjectAnalysis(uri.fsPath));
		watcher.onDidDelete((uri) => updateProjectAnalysis(uri.fsPath));
		
		// Generate analysis on startup
		updateProjectAnalysis();
		
		context.subscriptions.push(watcher);
	};
	
	// Initialize watcher when extension is activated
	setupFileWatcher();

	context.subscriptions.push(analyzeCommand);
	context.subscriptions.push(buildSymbolIndexCommand);
	context.subscriptions.push(generateDocstringIndexCommand);
	context.subscriptions.push(extractContextCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
