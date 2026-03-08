import * as vscode from 'vscode';
import { DetectedRepo } from '../utils/repoDetector';

export class RepoItem extends vscode.TreeItem {
  constructor(
    public readonly repo: DetectedRepo,
    public readonly status?: { staged: number; modified: number; untracked: number }
  ) {
    super(repo.name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'repo';
    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getIcon();

    // Store repo path for commands
    this.resourceUri = vscode.Uri.file(repo.path);
  }

  private createTooltip(): string {
    const lines = [
      `Repository: ${this.repo.name}`,
      `Path: ${this.repo.path}`,
      `Branch: ${this.repo.branch}`,
    ];

    if (this.repo.isWorktree) {
      lines.push('Type: Worktree');
    }

    if (this.status) {
      if (this.status.staged > 0) {
        lines.push(`Staged: ${this.status.staged}`);
      }
      if (this.status.modified > 0) {
        lines.push(`Modified: ${this.status.modified}`);
      }
      if (this.status.untracked > 0) {
        lines.push(`Untracked: ${this.status.untracked}`);
      }
    }

    return lines.join('\n');
  }

  private createDescription(): string {
    const parts: string[] = [this.repo.branch];

    if (this.repo.isWorktree) {
      parts.push('(worktree)');
    }

    if (this.status) {
      const statusParts: string[] = [];
      if (this.status.staged > 0) {
        statusParts.push(`+${this.status.staged}`);
      }
      if (this.status.modified > 0) {
        statusParts.push(`~${this.status.modified}`);
      }
      if (this.status.untracked > 0) {
        statusParts.push(`?${this.status.untracked}`);
      }
      if (statusParts.length > 0) {
        parts.push(`[${statusParts.join(' ')}]`);
      }
    }

    return parts.join(' ');
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.repo.isWorktree) {
      return new vscode.ThemeIcon('git-branch');
    }

    if (this.status && (this.status.staged > 0 || this.status.modified > 0)) {
      return new vscode.ThemeIcon('repo-clone', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    return new vscode.ThemeIcon('repo');
  }
}
