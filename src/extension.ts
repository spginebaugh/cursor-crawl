// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { createSymbolIndex, updateSymbolIndex } from '@/features/symbol-index/symbol-index';
import { generateDocstringIndex, resumeDocstringGeneration } from '@/features/generate-docstring/generate-docstring';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { extractContextFiles, generateRelevantInfo } from '@/context-extractor';

// Import services
import { FileSystemService } from '@/shared/services/file-system-service';
import { WorkspaceService, showInformationMessage, showErrorMessage } from '@/shared/services/workspace-service';
import { OpenAiService } from '@/shared/services/openai-service';
import { ProgressService } from '@/shared/services/progress-service';
import { ProjectService } from '@/shared/services/project-service';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';
import { SymbolIndexOrchestrator } from '@/features/symbol-index/symbol-index-orchestrator';

/**
 * Ensures project analysis artifacts are generated and up-to-date
 * @param rootPath - The workspace root path
 * @param options - Optional configuration
 * @returns Whether the operation was successful
 */
async function ensureProjectAnalysis(
	rootPath: string,
	options: {
		generateDocstrings?: boolean;
		showMessages?: boolean;
		progress?: vscode.Progress<{ message: string }>;
	} = {}
): Promise<boolean> {
	const { generateDocstrings = false, showMessages = true, progress } = options;
	
	try {
		// Create .cursortest directory if it doesn't exist
		await WorkspaceService.ensureCursorTestDir(rootPath);
		
		// Parse .gitignore
		const ignoredPatterns = await FileSystemService.parseGitignore(rootPath);
		
		// Generate project tree
		progress?.report({ message: 'Generating project tree...' });
		const treeContent = await ProjectService.generateProjectTree(rootPath, ignoredPatterns);
		
		// Write project tree to file
		await WorkspaceService.writeCursorTestFile(rootPath, 'project-tree.mdc', `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`);
		
		// Generate symbol index
		progress?.report({ message: 'Building symbol index...' });
		await createSymbolIndex(rootPath, ignoredPatterns, progress);
		
		// If docstrings are requested, generate them
		if (generateDocstrings) {
			// Check for OpenAI API key
			const envVars = OpenAiService.loadEnvironmentVars(rootPath);
			if (!envVars.OPENAI_API_KEY) {
				if (showMessages) {
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
							await vscode.workspace.getConfiguration('cursorcrawl').update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);
						} else {
							if (showMessages) {
								showInformationMessage('Symbol Index built successfully (without docstrings).');
							}
							return true;
						}
					} else {
						if (showMessages) {
							showInformationMessage('Symbol Index built successfully (without docstrings).');
						}
						return true;
					}
				} else {
					return true; // Skip docstrings but consider it a success
				}
			}
			
			// Generate docstrings
			progress?.report({ message: 'Generating docstrings...' });
			await generateDocstringIndex(rootPath, ignoredPatterns, progress);
			
			if (showMessages) {
				showInformationMessage('Project analysis completed successfully with docstrings!');
			}
		} else if (showMessages) {
			showInformationMessage('Project analysis completed successfully (without docstrings).');
		}
		
		return true;
	} catch (error) {
		console.error('Error in project analysis:', error);
		if (showMessages) {
			showErrorMessage('Error generating project analysis', error);
		}
		return false;
	}
}

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
		
		// Ask if docstrings should be generated
		const generateDocstrings = await vscode.window.showQuickPick(
			[
				{ label: 'Yes', description: 'Build symbol index and generate docstrings' },
				{ label: 'No', description: 'Build symbol index only (no AI-generated docstrings)' }
			],
			{ placeHolder: 'Would you like to generate docstrings? This requires an OpenAI API key.' }
		);
		
		if (!generateDocstrings) {
			return; // User canceled
		}
		
		await ProgressService.runWithProgress(
			'Analyzing Project',
			async (progress) => {
				await ensureProjectAnalysis(rootPath, {
					generateDocstrings: generateDocstrings.label === 'Yes',
					showMessages: true,
					progress
				});
			}
		);
	});

	// Register the build symbol index command
	const buildSymbolIndexCommand = vscode.commands.registerCommand('cursorcrawl.buildSymbolIndex', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			showErrorMessage('No workspace folder open.');
			return;
		}
		
		const rootPath = workspaceFolders[0].uri.fsPath;
		
		await ProgressService.runWithProgress(
			'Building Symbol Index',
			async (progress) => {
				await ensureProjectAnalysis(rootPath, {
					generateDocstrings: false,
					showMessages: true,
					progress
				});
			}
		);
	});

	// Register the generate docstring index command
	const generateDocstringIndexCommand = vscode.commands.registerCommand('cursorcrawl.generateDocstringIndex', async () => {
		const workspaceFolder = WorkspaceService.getWorkspaceFolder();
		if (!workspaceFolder) {
			showErrorMessage('No workspace folder open.');
			return;
		}
		
		// Load environment variables
		const envVars = OpenAiService.loadEnvironmentVars(workspaceFolder);
		if (!envVars.OPENAI_API_KEY) {
			showErrorMessage('OpenAI API key not found. Please set it in .env.local or in settings.');
			return;
		}
		
		// Check if symbol index exists
		if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
			const response = await vscode.window.showErrorMessage(
				'Symbol index not found. Would you like to build the symbol index first?',
				'Yes', 'No'
			);
			
			if (response === 'Yes') {
				// Run build symbol index first
				await vscode.commands.executeCommand('cursorcrawl.buildSymbolIndex');
			} else {
				return;
			}
		}
		
		await ProgressService.runWithProgress(
			'Generating Docstring Index',
			async (progress) => {
				try {
					// Get ignored patterns from .gitignore
					const ignoredPatterns = await FileSystemService.parseGitignore(workspaceFolder);
					
					// Generate docstrings for the existing symbol index
					await generateDocstringIndex(workspaceFolder, ignoredPatterns, progress);
					
					showInformationMessage('Docstrings generated successfully.');
				} catch (error) {
					console.error('Error generating docstring index:', error);
					showErrorMessage('Error generating docstring index', error);
				}
			}
		);
	});

	// Register the extract context command
	const extractContextCommand = vscode.commands.registerCommand('cursorcrawl.extractContext', async () => {
		const workspaceFolder = WorkspaceService.getWorkspaceFolder();
		if (!workspaceFolder) {
			showErrorMessage('No workspace folder found. Please open a folder first.');
			return;
		}

		// Check if symbol index exists
		if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
			const response = await vscode.window.showErrorMessage(
				'Symbol index not found. Would you like to run analysis first?',
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
			await ProgressService.runWithProgress(
				"Extracting Context Information",
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
					const relevantInfoPath = path.join(WorkspaceService.getCursorTestDir(workspaceFolder), 'relevant-info.json');
					const document = await vscode.workspace.openTextDocument(relevantInfoPath);
					await vscode.window.showTextDocument(document);
				}
			);
		} catch (error) {
			console.error('Error extracting context information:', error);
			showErrorMessage('Error extracting context information', error);
		}
	});

	// Register the resume docstring generation command
	const resumeDocstringGenerationCommand = vscode.commands.registerCommand('cursorcrawl.resumeDocstringGeneration', async () => {
		const workspaceFolder = WorkspaceService.getWorkspaceFolder();
		if (!workspaceFolder) {
			showErrorMessage('No workspace folder open.');
			return;
		}
		
		// Load environment variables
		const envVars = OpenAiService.loadEnvironmentVars(workspaceFolder);
		if (!envVars.OPENAI_API_KEY) {
			showErrorMessage('OpenAI API key not found. Please set it in .env.local or in settings.');
			return;
		}
		
		// Check if symbol index exists
		if (!await SymbolIndexService.symbolIndexExists(workspaceFolder)) {
			const response = await vscode.window.showErrorMessage(
				'Symbol index not found. Would you like to build the symbol index first?',
				'Yes', 'No'
			);
			
			if (response === 'Yes') {
				// Run build symbol index first
				await vscode.commands.executeCommand('cursorcrawl.buildSymbolIndex');
			} else {
				return;
			}
		}
		
		await ProgressService.runWithProgress(
			'Resuming Docstring Generation',
			async (progress) => {
				try {
					// Get ignored patterns from .gitignore
					const ignoredPatterns = await FileSystemService.parseGitignore(workspaceFolder);
					
					// Resume docstring generation for the existing symbol index (only for empty docstrings)
					await resumeDocstringGeneration(workspaceFolder, ignoredPatterns, progress);
					
					showInformationMessage('Docstring generation resumed and completed successfully.');
				} catch (error) {
					console.error('Error resuming docstring generation:', error);
					showErrorMessage('Error resuming docstring generation', error);
				}
			}
		);
	});

	// Set up file system watcher
	const setupFileWatcher = () => {
		const workspaceFolder = WorkspaceService.getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
		
		// Shared symbol index state for incremental updates
		let symbolIndexCache: SymbolIndex | null = null;
		
		// Debounce to avoid too many updates
		let debounceTimer: NodeJS.Timeout | null = null;
		const updateProjectAnalysis = async (changedFile?: string) => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			
			debounceTimer = setTimeout(async () => {
				try {
					// Create .cursortest directory if it doesn't exist
					await WorkspaceService.ensureCursorTestDir(workspaceFolder);
					
					// Parse .gitignore
					const ignoredPatterns = await FileSystemService.parseGitignore(workspaceFolder);
					
					// Generate project tree
					const treeContent = await ProjectService.generateProjectTree(workspaceFolder, ignoredPatterns);
					
					// Write project tree to file
					await WorkspaceService.writeCursorTestFile(workspaceFolder, 'project-tree.mdc', `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`);
					
					// Update symbol index
					// If we have a symbol index cache and a specific file changed, do incremental update
					if (symbolIndexCache && changedFile) {
						symbolIndexCache = await SymbolIndexOrchestrator.updateSymbolIndex(
							workspaceFolder,
							symbolIndexCache,
							changedFile,
							ignoredPatterns
						);
					} else {
						// Otherwise do a full rebuild
						symbolIndexCache = await SymbolIndexOrchestrator.createSymbolIndex(workspaceFolder, ignoredPatterns);
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

	// Store commands in subscriptions to ensure proper disposal
	context.subscriptions.push(
		analyzeCommand,
		buildSymbolIndexCommand,
		generateDocstringIndexCommand,
		extractContextCommand,
		resumeDocstringGenerationCommand
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
