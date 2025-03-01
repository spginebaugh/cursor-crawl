import * as vscode from 'vscode';
import { SymbolIndex } from '@/shared/types/symbol-index';
import { WorkspaceService } from '@/shared/services/workspace-service';
import { FileSystemService } from '@/shared/services/file-system-service';
import { ProjectService } from '@/shared/services/project-service';
import { SymbolIndexOrchestrator } from '@/features/symbol-index/symbol-index-orchestrator';
import { ensureProjectAnalysis } from '@/shared/utils/project-analysis';
import { SymbolIndexService } from '@/shared/services/symbol-index-service';

/**
 * Sets up a file system watcher to automatically update project analysis when files change
 * @param context - The extension context for registration
 */
export const setupFileWatcher = (context: vscode.ExtensionContext): void => {
    const workspaceFolder = WorkspaceService.getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    
    // Shared symbol index state for incremental updates
    let symbolIndexCache: SymbolIndex | undefined = undefined;
    
    // Initialize symbolIndexCache from on-disk file if available
    const initializeSymbolIndexCache = async () => {
        try {
            const onDiskIndex = await SymbolIndexService.readSymbolIndex(workspaceFolder);
            if (onDiskIndex) {
                symbolIndexCache = onDiskIndex;
                console.log('Initialized symbol index cache from on-disk file');
            }
        } catch (error) {
            console.error('Error initializing symbol index cache:', error);
        }
    };
    
    // Debounce to avoid too many updates
    let debounceTimer: NodeJS.Timeout | null = null;
    const updateProjectAnalysis = async (changedFile?: string) => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(async () => {
            try {
                // Ensure we have the latest on-disk version before updating when a file changes
                if (changedFile && !symbolIndexCache) {
                    await initializeSymbolIndexCache();
                }
                
                // Use the refactored project analysis workflow
                const result = await ensureProjectAnalysis(workspaceFolder, {
                    generateDocstrings: false,
                    showMessages: false,
                    incremental: !!changedFile && !!symbolIndexCache,
                    changedFile,
                    symbolIndexCache
                });
                
                // Update the symbol index cache if successful
                if (result.success && result.symbolIndex) {
                    symbolIndexCache = result.symbolIndex;
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
    
    // Initialize cache from disk and then generate analysis on startup
    initializeSymbolIndexCache().then(() => {
        updateProjectAnalysis();
    });
    
    context.subscriptions.push(watcher);
}; 