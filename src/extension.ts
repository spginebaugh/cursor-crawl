// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Function to read .gitignore and parse its rules
const parseGitignore = async (rootPath: string): Promise<string[]> => {
	try {
		const gitignorePath = path.join(rootPath, '.gitignore');
		if (await fs.pathExists(gitignorePath)) {
			const content = await fs.readFile(gitignorePath, 'utf8');
			return content
				.split('\n')
				.map((line: string) => line.trim())
				.filter((line: string) => line && !line.startsWith('#'));
		}
		return [];
	} catch (error) {
		console.error('Error parsing .gitignore:', error);
		return [];
	}
};

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

// Function to build a tree structure from a list of file paths
const buildTreeFromPaths = (paths: string[]): Record<string, any> => {
	const tree: Record<string, any> = {};
	
	for (const filePath of paths) {
		const parts = filePath.split('/');
		let current = tree;
		
		// Process all directories in the path
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!current[part]) {
				current[part] = {};
			}
			current = current[part];
		}
		
		// Add the file (last part)
		const fileName = parts[parts.length - 1];
		current[fileName] = null; // null indicates it's a file
	}
	
	return tree;
};

// Function to format the tree as a string
const formatTree = (tree: Record<string, any>, prefix: string = ''): string => {
	let result = '';
	const entries = Object.entries(tree);
	
	entries.forEach(([name, subtree], index) => {
		const isLast = index === entries.length - 1;
		const linePrefix = isLast ? '└── ' : '├── ';
		const childPrefix = isLast ? '    ' : '│   ';
		
		result += `${prefix}${linePrefix}${name}\n`;
		
		if (subtree !== null) {
			result += formatTree(subtree, `${prefix}${childPrefix}`);
		}
	});
	
	return result;
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "cursorcrawl" is now active!');

	// Register the analyze command
	const analyzeCommand = vscode.commands.registerCommand('cursorcrawl.analyze', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		
		try {
			// Create .cursortest directory if it doesn't exist
			const cursorTestDir = path.join(rootPath, '.cursortest');
			await fs.ensureDir(cursorTestDir);
			
			// Parse .gitignore
			const ignoredPatterns = await parseGitignore(rootPath);
			
			// Generate project tree
			const treeContent = await generateProjectTree(rootPath, ignoredPatterns);
			
			// Write project tree to file
			const projectTreePath = path.join(cursorTestDir, 'project-tree.mdc');
			await fs.writeFile(projectTreePath, `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`, 'utf8');
			
			vscode.window.showInformationMessage('Project tree generated successfully!');
			
			// Open the file in the editor
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(projectTreePath));
			await vscode.window.showTextDocument(document);
		} catch (error) {
			console.error('Error generating project tree:', error);
			vscode.window.showErrorMessage(`Error generating project tree: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// Set up file system watcher
	const setupFileWatcher = () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
		
		// Debounce to avoid too many updates
		let debounceTimer: NodeJS.Timeout | null = null;
		const updateProjectTree = async () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			
			debounceTimer = setTimeout(async () => {
				try {
					// Create .cursortest directory if it doesn't exist
					const cursorTestDir = path.join(rootPath, '.cursortest');
					await fs.ensureDir(cursorTestDir);
					
					// Parse .gitignore
					const ignoredPatterns = await parseGitignore(rootPath);
					
					// Generate project tree
					const treeContent = await generateProjectTree(rootPath, ignoredPatterns);
					
					// Write project tree to file
					const projectTreePath = path.join(cursorTestDir, 'project-tree.mdc');
					await fs.writeFile(projectTreePath, `# Project Tree\n\n\`\`\`\n${treeContent}\`\`\`\n`, 'utf8');
					
					console.log('Project tree updated automatically.');
				} catch (error) {
					console.error('Error updating project tree:', error);
				}
			}, 1000); // Wait 1 second after the last change
		};
		
		// Watch for file changes
		watcher.onDidCreate(updateProjectTree);
		watcher.onDidChange(updateProjectTree);
		watcher.onDidDelete(updateProjectTree);
		
		// Generate tree on startup
		updateProjectTree();
		
		context.subscriptions.push(watcher);
	};
	
	// Initialize watcher when extension is activated
	setupFileWatcher();
	
	context.subscriptions.push(analyzeCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
