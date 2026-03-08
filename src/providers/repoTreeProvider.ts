import * as vscode from 'vscode';
import { RepoItem } from './repoItem';
import { detectReposInWorkspace, DetectedRepo, validateRepoPath } from '../utils/repoDetector';
import { gitService } from '../services/gitService';

const MANUAL_REPOS_KEY = 'code-review.manualRepos';

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<RepoItem | undefined | null | void> =
    new vscode.EventEmitter<RepoItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<RepoItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private repos: DetectedRepo[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadRepos();
  }

  refresh(): void {
    this.loadRepos();
  }

  private async loadRepos(): Promise<void> {
    // Get auto-detected repos
    const detectedRepos = await detectReposInWorkspace();

    // Get manually added repos
    const manualPaths = this.context.workspaceState.get<string[]>(MANUAL_REPOS_KEY, []);
    const validManualPaths: string[] = [];

    for (const repoPath of manualPaths) {
      if (await validateRepoPath(repoPath)) {
        validManualPaths.push(repoPath);
      }
    }

    // Update stored paths if some were invalid
    if (validManualPaths.length !== manualPaths.length) {
      await this.context.workspaceState.update(MANUAL_REPOS_KEY, validManualPaths);
    }

    // Create repo objects for manual paths
    const manualRepos: DetectedRepo[] = [];
    for (const repoPath of validManualPaths) {
      // Skip if already in detected repos
      if (detectedRepos.some((r) => r.path === repoPath)) {
        continue;
      }

      const [name, branch] = await Promise.all([
        gitService.getRepoName(repoPath),
        gitService.getCurrentBranch(repoPath),
      ]);

      manualRepos.push({
        path: repoPath,
        name,
        branch,
        isWorktree: false,
      });
    }

    this.repos = [...detectedRepos, ...manualRepos];
    this._onDidChangeTreeData.fire();
  }

  async addRepo(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Add Repository',
      title: 'Select a Git Repository',
    });

    if (!result || result.length === 0) {
      return;
    }

    const repoPath = result[0].fsPath;

    if (!(await validateRepoPath(repoPath))) {
      vscode.window.showErrorMessage('Selected folder is not a valid Git repository.');
      return;
    }

    // Check if already added
    const manualPaths = this.context.workspaceState.get<string[]>(MANUAL_REPOS_KEY, []);
    if (manualPaths.includes(repoPath) || this.repos.some((r) => r.path === repoPath)) {
      vscode.window.showInformationMessage('Repository is already in the list.');
      return;
    }

    // Add to manual repos
    manualPaths.push(repoPath);
    await this.context.workspaceState.update(MANUAL_REPOS_KEY, manualPaths);

    this.loadRepos();
    vscode.window.showInformationMessage(`Added repository: ${repoPath}`);
  }

  async removeRepo(item: RepoItem): Promise<void> {
    const manualPaths = this.context.workspaceState.get<string[]>(MANUAL_REPOS_KEY, []);
    const index = manualPaths.indexOf(item.repo.path);

    if (index === -1) {
      vscode.window.showWarningMessage(
        'This repository was auto-detected and cannot be removed. Close the workspace folder to remove it.'
      );
      return;
    }

    manualPaths.splice(index, 1);
    await this.context.workspaceState.update(MANUAL_REPOS_KEY, manualPaths);

    this.loadRepos();
    vscode.window.showInformationMessage(`Removed repository: ${item.repo.name}`);
  }

  getTreeItem(element: RepoItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: RepoItem): Promise<RepoItem[]> {
    // We only show a flat list of repos, no children
    if (_element) {
      return [];
    }

    const items: RepoItem[] = [];

    for (const repo of this.repos) {
      const status = await gitService.getStatus(repo.path);
      items.push(new RepoItem(repo, status));
    }

    return items;
  }

  getRepoByPath(repoPath: string): DetectedRepo | undefined {
    return this.repos.find((r) => r.path === repoPath);
  }
}
