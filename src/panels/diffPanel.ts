import * as vscode from 'vscode';
import { DetectedRepo } from '../utils/repoDetector';
import { gitService, DiffFile, CommitInfo } from '../services/gitService';

interface DiffData {
  staged: DiffFile[];
  unstaged: DiffFile[];
  untracked: string[];
  branchDiff: DiffFile[];
  defaultBranch: string;
  hasCommits: boolean;
  unpushedCommits: CommitInfo[];
  hasRemote: boolean;
}

export class DiffPanel {
  private activePanel: vscode.WebviewPanel | undefined;
  private currentRepo: DetectedRepo | undefined;

  async showDiff(
    repo: DetectedRepo,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.One
  ): Promise<void> {
    // Update current repo reference
    this.currentRepo = repo;

    if (this.activePanel) {
      // Reuse existing panel - update title and content
      this.activePanel.title = `Diff: ${repo.name}`;
      this.activePanel.reveal(viewColumn);
      await this.updatePanelContent(this.activePanel, repo);
      return;
    }

    // Create new panel
    this.activePanel = vscode.window.createWebviewPanel(
      'codeReviewDiff',
      `Diff: ${repo.name}`,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // Handle panel disposal
    this.activePanel.onDidDispose(() => {
      this.activePanel = undefined;
      this.currentRepo = undefined;
    });

    // Handle messages from webview - use this.currentRepo instead of captured repo
    this.activePanel.webview.onDidReceiveMessage(async (message) => {
      if (!this.currentRepo || !this.activePanel) return;

      if (message.command === 'refresh') {
        await this.updatePanelContent(this.activePanel, this.currentRepo);
      } else if (message.command === 'openFile') {
        const uri = vscode.Uri.file(message.filePath);
        await vscode.window.showTextDocument(uri);
      } else if (message.command === 'commit') {
        await this.commitChanges(this.currentRepo, message.message);
        await this.updatePanelContent(this.activePanel, this.currentRepo);
      } else if (message.command === 'push') {
        await this.pushChanges(this.currentRepo);
        await this.updatePanelContent(this.activePanel, this.currentRepo);
      }
    });

    await this.updatePanelContent(this.activePanel, repo);
  }

  async commitChanges(repo: DetectedRepo, message: string): Promise<void> {
    try {
      await gitService.commitAll(repo.path, message);
      vscode.window.showInformationMessage(`Committed changes: ${message}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to commit: ${error}`);
    }
  }

  async pushChanges(repo: DetectedRepo): Promise<void> {
    try {
      await gitService.push(repo.path);
      vscode.window.showInformationMessage(`Pushed changes to remote`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to push: ${error}`);
    }
  }

  private async updatePanelContent(
    panel: vscode.WebviewPanel,
    repo: DetectedRepo
  ): Promise<void> {
    const [defaultBranch, hasCommits, staged, unstaged, untracked, branchDiff, unpushedCommits, hasRemote] =
      await Promise.all([
        gitService.getDefaultBranch(repo.path),
        gitService.hasCommits(repo.path),
        gitService.getStagedDiff(repo.path),
        gitService.getUnstagedDiff(repo.path),
        gitService.getUntrackedFiles(repo.path),
        gitService.getDiffAgainstDefault(repo.path),
        gitService.getUnpushedCommits(repo.path),
        gitService.hasRemote(repo.path),
      ]);

    const diffData: DiffData = {
      staged,
      unstaged,
      untracked,
      branchDiff,
      defaultBranch,
      hasCommits,
      unpushedCommits,
      hasRemote,
    };

    panel.webview.html = this.getWebviewContent(repo, diffData);
  }

  private getWebviewContent(repo: DetectedRepo, data: DiffData): string {
    const hasUncommittedChanges =
      data.staged.length > 0 ||
      data.unstaged.length > 0 ||
      data.untracked.length > 0;

    const totalUncommittedFiles =
      data.staged.length + data.unstaged.length + data.untracked.length;

    const stagedHtml = data.staged
      .map((file) => this.renderFileDiff(file, repo.path, 'staged'))
      .join('');

    const unstagedHtml = data.unstaged
      .map((file) => this.renderFileDiff(file, repo.path, 'unstaged'))
      .join('');

    const untrackedHtml = data.untracked
      .map((file) => this.renderUntrackedFile(file, repo.path))
      .join('');

    const branchDiffHtml = data.branchDiff
      .map((file) => this.renderFileDiff(file, repo.path, 'branch'))
      .join('');

    const totalBranchAdditions = data.branchDiff.reduce(
      (sum, f) => sum + f.additions,
      0
    );
    const totalBranchDeletions = data.branchDiff.reduce(
      (sum, f) => sum + f.deletions,
      0
    );

    const unpushedCommitsHtml = data.unpushedCommits
      .map((commit) => `
        <div class="commit-item">
          <span class="commit-hash">${this.escapeHtml(commit.shortHash)}</span>
          <div class="commit-info">
            <div class="commit-message">${this.escapeHtml(commit.message)}</div>
            <div class="commit-meta">${this.escapeHtml(commit.author)} - ${this.escapeHtml(commit.date)}</div>
          </div>
        </div>
      `)
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diff: ${repo.name}</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background);
      --text-color: var(--vscode-editor-foreground);
      --border-color: var(--vscode-panel-border);
      --header-bg: var(--vscode-sideBarSectionHeader-background);
      --addition-bg: var(--vscode-diffEditor-insertedTextBackground, rgba(35, 134, 54, 0.2));
      --deletion-bg: var(--vscode-diffEditor-removedTextBackground, rgba(212, 76, 71, 0.2));
      --addition-color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
      --deletion-color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
      --untracked-color: var(--vscode-gitDecoration-untrackedResourceForeground, #d29922);
      --hunk-bg: var(--vscode-diffEditor-diagonalFill, rgba(128, 128, 128, 0.2));
    }

    * { box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-color);
      background-color: var(--bg-color);
      margin: 0;
      padding: 16px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .header h1 { margin: 0; font-size: 1.4em; font-weight: 500; }
    .header-info { color: var(--vscode-descriptionForeground); font-size: 0.9em; }

    .actions { display: flex; gap: 8px; align-items: center; }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 13px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-primary {
      background: var(--vscode-button-background);
    }

    .section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      font-weight: 500;
      font-size: 1.1em;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 12px;
    }

    .section-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
    }

    .stats { display: flex; gap: 16px; }
    .stat { display: flex; align-items: center; gap: 4px; }
    .stat.additions { color: var(--addition-color); }
    .stat.deletions { color: var(--deletion-color); }

    .no-changes {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }

    .file {
      margin-bottom: 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: clip;
    }

    .file-header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
    }
    .file-header:hover { background: var(--vscode-list-hoverBackground); }

    .file-name { font-family: var(--vscode-editor-font-family); font-weight: 500; }
    .file-name.untracked { color: var(--untracked-color); }

    .file-stats { display: flex; gap: 8px; font-size: 0.85em; align-items: center; }

    .file-badge {
      font-size: 0.75em;
      padding: 1px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .file-badge.staged { background: var(--addition-color); color: #000; }
    .file-badge.unstaged { background: var(--deletion-color); color: #fff; }
    .file-badge.untracked { background: var(--untracked-color); color: #000; }

    .diff-content {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5;
      overflow-x: auto;
    }

    .diff-line { white-space: pre; padding: 0 12px; }
    .diff-line.addition { background: var(--addition-bg); }
    .diff-line.deletion { background: var(--deletion-bg); }
    .diff-line.hunk { background: var(--hunk-bg); color: var(--vscode-descriptionForeground); padding: 4px 12px; }
    .diff-line.context { color: var(--vscode-descriptionForeground); }

    .collapsed .diff-content { display: none; }
    .toggle-icon { transition: transform 0.2s; }
    .collapsed .toggle-icon { transform: rotate(-90deg); }

    .commit-box {
      background: var(--header-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 20px;
    }

    .commit-input {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--border-color);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      margin-bottom: 8px;
      font-family: inherit;
    }

    .commit-actions {
      display: flex;
      gap: 8px;
    }

    .push-box {
      background: var(--header-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 20px;
    }

    .push-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .push-title {
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .commit-list {
      margin-bottom: 12px;
      max-height: 200px;
      overflow-y: auto;
    }

    .commit-item {
      display: flex;
      align-items: flex-start;
      padding: 8px;
      border-bottom: 1px solid var(--border-color);
      gap: 12px;
    }

    .commit-item:last-child {
      border-bottom: none;
    }

    .commit-hash {
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-textLink-foreground);
      font-size: 0.85em;
      flex-shrink: 0;
    }

    .commit-info {
      flex: 1;
      min-width: 0;
    }

    .commit-message {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .commit-meta {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${this.escapeHtml(repo.name)}</h1>
      <div class="header-info">Branch: <strong>${this.escapeHtml(repo.branch)}</strong></div>
    </div>
    <div class="actions">
      <button class="btn" onclick="refresh()">Refresh</button>
    </div>
  </div>

  ${hasUncommittedChanges ? `
  <div class="commit-box">
    <input type="text" class="commit-input" id="commitMessage" placeholder="Commit message..." value="add all files" />
    <div class="commit-actions">
      <button class="btn btn-primary" onclick="commit()">Commit All Changes (${totalUncommittedFiles} files)</button>
    </div>
  </div>
  ` : ''}

  ${data.unpushedCommits.length > 0 ? `
  <div class="push-box">
    <div class="push-header">
      <span class="push-title">
        Unpushed Commits
        <span class="section-badge">${data.unpushedCommits.length}</span>
      </span>
      ${data.hasRemote ? `
        <button class="btn btn-primary" onclick="push()">Push to Remote</button>
      ` : `
        <span style="color: var(--vscode-descriptionForeground); font-size: 0.9em;">No remote configured</span>
      `}
    </div>
    <div class="commit-list">
      ${unpushedCommitsHtml}
    </div>
  </div>
  ` : ''}

  ${data.staged.length > 0 ? `
  <div class="section">
    <div class="section-header">
      <span>Staged Changes</span>
      <span class="section-badge">${data.staged.length}</span>
    </div>
    ${stagedHtml}
  </div>
  ` : ''}

  ${data.unstaged.length > 0 ? `
  <div class="section">
    <div class="section-header">
      <span>Unstaged Changes</span>
      <span class="section-badge">${data.unstaged.length}</span>
    </div>
    ${unstagedHtml}
  </div>
  ` : ''}

  ${data.untracked.length > 0 ? `
  <div class="section">
    <div class="section-header">
      <span>Untracked Files</span>
      <span class="section-badge">${data.untracked.length}</span>
    </div>
    ${untrackedHtml}
  </div>
  ` : ''}

  ${data.hasCommits && data.branchDiff.length > 0 ? `
  <div class="section">
    <div class="section-header">
      <span>Changes vs ${this.escapeHtml(data.defaultBranch)}</span>
      <div class="stats">
        <span class="stat additions">+${totalBranchAdditions}</span>
        <span class="stat deletions">-${totalBranchDeletions}</span>
        <span class="section-badge">${data.branchDiff.length} files</span>
      </div>
    </div>
    ${branchDiffHtml}
  </div>
  ` : ''}

  ${!hasUncommittedChanges && data.branchDiff.length === 0 ? `
  <div class="no-changes">
    ${data.hasCommits
      ? `No changes compared to ${this.escapeHtml(data.defaultBranch)}`
      : 'No commits yet. Make changes and commit to get started.'}
  </div>
  ` : ''}

  <script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function openFile(filePath) {
      vscode.postMessage({ command: 'openFile', filePath: filePath });
    }

    function toggleFile(element) {
      const file = element.closest('.file');
      file.classList.toggle('collapsed');
    }

    function commit() {
      const message = document.getElementById('commitMessage').value || 'add all files';
      vscode.postMessage({ command: 'commit', message: message });
    }

    function push() {
      vscode.postMessage({ command: 'push' });
    }
  </script>
</body>
</html>`;
  }

  private renderFileDiff(
    file: DiffFile,
    repoPath: string,
    type: 'staged' | 'unstaged' | 'branch'
  ): string {
    const fullPath = `${repoPath}/${file.file}`;
    const lines = file.diff.split('\n');
    const diffLines = lines
      .slice(4)
      .map((line) => {
        if (line.startsWith('@@')) {
          return `<div class="diff-line hunk">${this.escapeHtml(line)}</div>`;
        } else if (line.startsWith('+')) {
          return `<div class="diff-line addition">${this.escapeHtml(line)}</div>`;
        } else if (line.startsWith('-')) {
          return `<div class="diff-line deletion">${this.escapeHtml(line)}</div>`;
        } else {
          return `<div class="diff-line context">${this.escapeHtml(line)}</div>`;
        }
      })
      .join('');

    const badgeClass = type;
    const badgeText = type === 'branch' ? '' : type;

    return `
<div class="file">
  <div class="file-header" onclick="toggleFile(this)">
    <span class="file-name">
      <span class="toggle-icon">▼</span>
      ${this.escapeHtml(file.file)}
    </span>
    <div class="file-stats">
      ${badgeText ? `<span class="file-badge ${badgeClass}">${badgeText}</span>` : ''}
      <span class="stat additions">+${file.additions}</span>
      <span class="stat deletions">-${file.deletions}</span>
      <button onclick="event.stopPropagation(); openFile('${this.escapeHtml(fullPath)}')">Open</button>
    </div>
  </div>
  <div class="diff-content">
    ${diffLines}
  </div>
</div>`;
  }

  private renderUntrackedFile(file: string, repoPath: string): string {
    const fullPath = `${repoPath}/${file}`;

    return `
<div class="file">
  <div class="file-header">
    <span class="file-name untracked">${this.escapeHtml(file)}</span>
    <div class="file-stats">
      <span class="file-badge untracked">new</span>
      <button onclick="openFile('${this.escapeHtml(fullPath)}')">Open</button>
    </div>
  </div>
</div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  dispose(): void {
    if (this.activePanel) {
      this.activePanel.dispose();
      this.activePanel = undefined;
      this.currentRepo = undefined;
    }
  }
}
