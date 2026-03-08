import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Prism = require('prismjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadLanguages = require('prismjs/components/');

// Load all language components using Prism's Node.js loader
loadLanguages([
  'markup', 'css', 'clike', 'javascript', 'typescript', 'json', 'markdown',
  'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'php', 'ruby',
  'swift', 'kotlin', 'scala', 'yaml', 'toml', 'sql', 'bash', 'docker', 'makefile'
]);

import { DetectedRepo } from '../utils/repoDetector';
import { gitService, DiffFile, CommitInfo } from '../services/gitService';
import {
  escapeHtml,
  getLanguageFromFile,
  MAX_DIFF_LINES,
} from '../utils/diffUtils';

interface DiffData {
  staged: DiffFile[];
  unstaged: DiffFile[];
  untracked: DiffFile[];
  branchDiff: DiffFile[];
  defaultBranch: string;
  hasCommits: boolean;
  unpushedCommits: CommitInfo[];
  hasRemote: boolean;
}

export class DiffPanel {
  private activePanel: vscode.WebviewPanel | undefined;
  private currentRepo: DetectedRepo | undefined;
  private scrollPositions: Map<string, number> = new Map();

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
      try {
        await this.updatePanelContent(this.activePanel, repo);
      } catch (error) {
        console.error('Failed to update diff panel content:', error);
      }
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
      } else if (message.command === 'saveScrollPosition') {
        if (this.currentRepo) {
          this.scrollPositions.set(this.currentRepo.path, message.scrollTop);
        }
      }
    });

    try {
      await this.updatePanelContent(this.activePanel, repo);
    } catch (error) {
      console.error('Failed to initialize diff panel content:', error);
    }
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

  private getCurrentTheme(): 'light' | 'dark' {
    const themeKind = vscode.window.activeColorTheme.kind;
    return themeKind === vscode.ColorThemeKind.Light ? 'light' : 'dark';
  }

  private getPrismLanguage(lang: string): string {
    const mapping: Record<string, string> = {
      'typescript': 'typescript',
      'javascript': 'javascript',
      'html': 'markup',
      'dockerfile': 'docker',
      'csharp': 'csharp',
      'plaintext': 'plaintext',
    };
    return mapping[lang] || lang;
  }

  private highlightCode(code: string, lang: string): string[] {
    try {
      const prismLang = this.getPrismLanguage(lang);
      const grammar = Prism.languages[prismLang];

      if (!grammar) {
        // Fallback to plain text
        return code.split('\n').map(line => escapeHtml(line));
      }

      const html = Prism.highlight(code, grammar, prismLang);
      return html.split('\n');
    } catch (error) {
      // Fallback to plain text on error
      return code.split('\n').map(line => escapeHtml(line));
    }
  }

  private async updatePanelContent(
    panel: vscode.WebviewPanel,
    repo: DetectedRepo
  ): Promise<void> {
    try {
      const [defaultBranch, hasCommits, staged, unstaged, untracked, branchDiff, unpushedCommits, hasRemote] =
        await Promise.all([
          gitService.getDefaultBranch(repo.path),
          gitService.hasCommits(repo.path),
          gitService.getStagedDiff(repo.path),
          gitService.getUnstagedDiff(repo.path),
          gitService.getUntrackedFilesWithContent(repo.path),
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

      const html = this.getWebviewContent(repo, diffData);
      panel.webview.html = html;

      // Restore scroll position for this repo if available
      const savedScrollTop = this.scrollPositions.get(repo.path);
      if (savedScrollTop !== undefined && savedScrollTop > 0) {
        setTimeout(() => {
          panel.webview.postMessage({
            command: 'restoreScrollPosition',
            scrollTop: savedScrollTop
          });
        }, 100);
      }
    } catch (error) {
      console.error('Error generating webview content:', error);
      panel.webview.html = `<html><body><h1>Error</h1><pre>${escapeHtml(String(error))}</pre></body></html>`;
    }
  }

  private getWebviewContent(repo: DetectedRepo, data: DiffData): string {
    const hasUncommittedChanges =
      data.staged.length > 0 ||
      data.unstaged.length > 0 ||
      data.untracked.length > 0;

    const totalUncommittedFiles =
      data.staged.length + data.unstaged.length + data.untracked.length;

    const theme = this.getCurrentTheme();
    const themeClass = theme === 'light' ? 'light-theme' : 'dark-theme';

    const stagedHtml = data.staged.map((file) => this.renderFileDiff(file, repo.path, 'staged')).join('');
    const unstagedHtml = data.unstaged.map((file) => this.renderFileDiff(file, repo.path, 'unstaged')).join('');
    const untrackedHtml = data.untracked.map((file) => this.renderUntrackedFile(file, repo.path)).join('');
    const branchDiffHtml = data.branchDiff.map((file) => this.renderFileDiff(file, repo.path, 'branch')).join('');

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
          <span class="commit-hash">${escapeHtml(commit.shortHash)}</span>
          <div class="commit-info">
            <div class="commit-message">${escapeHtml(commit.message)}</div>
            <div class="commit-meta">${escapeHtml(commit.author)} - ${escapeHtml(commit.date)}</div>
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

    .diff-line-wrapper {
      display: flex;
      align-items: stretch;
    }

    .line-numbers {
      display: flex;
      flex-shrink: 0;
      user-select: none;
    }

    .line-number {
      display: inline-block;
      width: 40px;
      padding: 0 8px;
      text-align: right;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size, 13px);
      color: var(--vscode-editorLineNumber-foreground, rgba(128, 128, 128, 0.7));
      background: var(--vscode-editorGutter-background, transparent);
      border-right: 1px solid var(--border-color);
    }

    .line-number.old {
      border-right: none;
    }

    .diff-line { white-space: pre; padding: 0 12px; flex: 1; min-width: 0; }
    .diff-line.addition { background: var(--addition-bg); }
    .diff-line.deletion { background: var(--deletion-bg); }
    .diff-line.hunk { background: var(--hunk-bg); color: var(--vscode-descriptionForeground); padding: 4px 12px; }
    .diff-line.context { }

    /* Diff marker styling */
    .diff-marker {
      display: inline-block;
      width: 1ch;
      user-select: none;
    }

    /* Prism syntax highlighting - keep token spans inline */
    .diff-line span { display: inline; }
    .diff-line code { background: transparent !important; }
    .diff-line pre { margin: 0; background: transparent !important; }

    .diff-line-wrapper.addition .line-numbers { background: var(--addition-bg); }
    .diff-line-wrapper.deletion .line-numbers { background: var(--deletion-bg); }
    .diff-line-wrapper.hunk .line-numbers { background: var(--hunk-bg); }
    .diff-line-wrapper.hunk .line-number { border-right: none; }

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

    /* Prism.js GitHub Light Theme */
    .light-theme .diff-line .token.comment,
    .light-theme .diff-line .token.prolog,
    .light-theme .diff-line .token.doctype,
    .light-theme .diff-line .token.cdata { color: #6a737d !important; }

    .light-theme .diff-line .token.punctuation { color: #24292e !important; }

    .light-theme .diff-line .token.property,
    .light-theme .diff-line .token.tag,
    .light-theme .diff-line .token.boolean,
    .light-theme .diff-line .token.number,
    .light-theme .diff-line .token.constant,
    .light-theme .diff-line .token.symbol { color: #005cc5 !important; }

    .light-theme .diff-line .token.selector,
    .light-theme .diff-line .token.attr-name,
    .light-theme .diff-line .token.string,
    .light-theme .diff-line .token.char,
    .light-theme .diff-line .token.builtin { color: #032f62 !important; }

    .light-theme .diff-line .token.operator,
    .light-theme .diff-line .token.entity,
    .light-theme .diff-line .token.url,
    .light-theme .diff-line .token.variable { color: #d73a49 !important; }

    .light-theme .diff-line .token.atrule,
    .light-theme .diff-line .token.attr-value,
    .light-theme .diff-line .token.keyword { color: #d73a49 !important; }

    .light-theme .diff-line .token.function,
    .light-theme .diff-line .token.class-name { color: #6f42c1 !important; }

    .light-theme .diff-line .token.regex,
    .light-theme .diff-line .token.important { color: #e36209 !important; }

    /* Prism.js GitHub Dark Theme */
    .dark-theme .diff-line .token.comment,
    .dark-theme .diff-line .token.prolog,
    .dark-theme .diff-line .token.doctype,
    .dark-theme .diff-line .token.cdata { color: #8b949e !important; }

    .dark-theme .diff-line .token.punctuation { color: #c9d1d9 !important; }

    .dark-theme .diff-line .token.property,
    .dark-theme .diff-line .token.tag,
    .dark-theme .diff-line .token.boolean,
    .dark-theme .diff-line .token.number,
    .dark-theme .diff-line .token.constant,
    .dark-theme .diff-line .token.symbol { color: #79c0ff !important; }

    .dark-theme .diff-line .token.selector,
    .dark-theme .diff-line .token.attr-name,
    .dark-theme .diff-line .token.string,
    .dark-theme .diff-line .token.char,
    .dark-theme .diff-line .token.builtin { color: #a5d6ff !important; }

    .dark-theme .diff-line .token.operator,
    .dark-theme .diff-line .token.entity,
    .dark-theme .diff-line .token.url,
    .dark-theme .diff-line .token.variable { color: #ff7b72 !important; }

    .dark-theme .diff-line .token.atrule,
    .dark-theme .diff-line .token.attr-value,
    .dark-theme .diff-line .token.keyword { color: #ff7b72 !important; }

    .dark-theme .diff-line .token.function,
    .dark-theme .diff-line .token.class-name { color: #d2a8ff !important; }

    .dark-theme .diff-line .token.regex,
    .dark-theme .diff-line .token.important { color: #ffa657 !important; }
  </style>
</head>
<body class="${themeClass}">
  <div class="header">
    <div>
      <h1>${escapeHtml(repo.name)}</h1>
      <div class="header-info">Branch: <strong>${escapeHtml(repo.branch)}</strong></div>
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
      <span>Changes vs ${escapeHtml(data.defaultBranch)}</span>
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
      ? `No changes compared to ${escapeHtml(data.defaultBranch)}`
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

    // Track scroll position continuously (debounced)
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        vscode.postMessage({
          command: 'saveScrollPosition',
          scrollTop: window.scrollY
        });
      }, 100);
    });

    // Handle restore message from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'restoreScrollPosition') {
        window.scrollTo(0, message.scrollTop);
      }
    });
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
    const allLines = file.diff.split('\n');
    const lang = getLanguageFromFile(file.file);

    // Check if diff exceeds size limit
    const isTruncated = allLines.length > MAX_DIFF_LINES;
    const lines = isTruncated ? allLines.slice(0, MAX_DIFF_LINES) : allLines;

    // First pass: synchronously compute line metadata
    interface LineMeta {
      type: 'hunk' | 'addition' | 'deletion' | 'context';
      oldLine: number | null;
      newLine: number | null;
      code: string;
      rawLine: string;
    }

    let oldLineNum = 0;
    let newLineNum = 0;
    const linesMeta: LineMeta[] = [];
    const codeLines: string[] = [];

    for (const line of lines.slice(4)) {
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -old,count +new,count @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNum = parseInt(match[1], 10);
          newLineNum = parseInt(match[2], 10);
        }
        linesMeta.push({ type: 'hunk', oldLine: null, newLine: null, code: '', rawLine: line });
      } else if (line.startsWith('+')) {
        const code = line.substring(1);
        linesMeta.push({ type: 'addition', oldLine: null, newLine: newLineNum, code, rawLine: line });
        codeLines.push(code);
        newLineNum++;
      } else if (line.startsWith('-')) {
        const code = line.substring(1);
        linesMeta.push({ type: 'deletion', oldLine: oldLineNum, newLine: null, code, rawLine: line });
        codeLines.push(code);
        oldLineNum++;
      } else {
        const code = line.startsWith(' ') ? line.substring(1) : line;
        linesMeta.push({ type: 'context', oldLine: oldLineNum, newLine: newLineNum, code, rawLine: line });
        codeLines.push(code);
        oldLineNum++;
        newLineNum++;
      }
    }

    // Second pass: highlight all code lines in batch
    const highlightedLines = codeLines.length > 0
      ? this.highlightCode(codeLines.join('\n'), lang)
      : [];

    // Third pass: combine metadata with highlighted output
    let codeIndex = 0;
    const diffLines = linesMeta.map((meta) => {
      if (meta.type === 'hunk') {
        return `<div class="diff-line-wrapper hunk">
          <span class="line-numbers"><span class="line-number old"></span><span class="line-number new"></span></span>
          <div class="diff-line hunk">${escapeHtml(meta.rawLine)}</div>
        </div>`;
      }

      const highlighted = highlightedLines[codeIndex++] || escapeHtml(meta.code);

      if (meta.type === 'addition') {
        return `<div class="diff-line-wrapper addition">
          <span class="line-numbers"><span class="line-number old"></span><span class="line-number new">${meta.newLine}</span></span>
          <div class="diff-line addition"><span class="diff-marker">+</span>${highlighted}</div>
        </div>`;
      } else if (meta.type === 'deletion') {
        return `<div class="diff-line-wrapper deletion">
          <span class="line-numbers"><span class="line-number old">${meta.oldLine}</span><span class="line-number new"></span></span>
          <div class="diff-line deletion"><span class="diff-marker">-</span>${highlighted}</div>
        </div>`;
      } else {
        return `<div class="diff-line-wrapper context">
          <span class="line-numbers"><span class="line-number old">${meta.oldLine}</span><span class="line-number new">${meta.newLine}</span></span>
          <div class="diff-line context"><span class="diff-marker"> </span>${highlighted}</div>
        </div>`;
      }
    });

    const badgeClass = type;
    const badgeText = type === 'branch' ? '' : type;

    const truncationMessage = isTruncated
      ? `<div class="diff-line-wrapper hunk">
          <span class="line-numbers"><span class="line-number old"></span><span class="line-number new"></span></span>
          <div class="diff-line hunk">... Diff truncated (${allLines.length - MAX_DIFF_LINES} more lines). Open file to view full content.</div>
        </div>`
      : '';

    return `
<div class="file">
  <div class="file-header" onclick="toggleFile(this)">
    <span class="file-name">
      <span class="toggle-icon">▼</span>
      ${escapeHtml(file.file)}
    </span>
    <div class="file-stats">
      ${badgeText ? `<span class="file-badge ${badgeClass}">${badgeText}</span>` : ''}
      <span class="stat additions">+${file.additions}</span>
      <span class="stat deletions">-${file.deletions}</span>
      <button onclick="event.stopPropagation(); openFile('${escapeHtml(fullPath)}')">Open</button>
    </div>
  </div>
  <div class="diff-content">
    ${diffLines.join('')}
    ${truncationMessage}
  </div>
</div>`;
  }

  private renderUntrackedFile(
    file: DiffFile,
    repoPath: string
  ): string {
    const fullPath = `${repoPath}/${file.file}`;
    const lang = getLanguageFromFile(file.file);
    const allContentLines = file.diff.split('\n');

    // Check if file exceeds size limit
    const isTruncated = allContentLines.length > MAX_DIFF_LINES;
    const contentLines = isTruncated
      ? allContentLines.slice(0, MAX_DIFF_LINES)
      : allContentLines;
    const fileContent = contentLines.join('\n');

    // Highlight file content at once
    const highlightedLines = this.highlightCode(fileContent, lang);

    // Build HTML for each line with pre-computed line numbers
    const lines = highlightedLines.map((highlighted, index) => {
      const lineNum = index + 1;
      return `<div class="diff-line-wrapper addition">
        <span class="line-numbers"><span class="line-number old"></span><span class="line-number new">${lineNum}</span></span>
        <div class="diff-line addition"><span class="diff-marker">+</span>${highlighted}</div>
      </div>`;
    });

    const truncationMessage = isTruncated
      ? `<div class="diff-line-wrapper hunk">
          <span class="line-numbers"><span class="line-number old"></span><span class="line-number new"></span></span>
          <div class="diff-line hunk">... File truncated (${allContentLines.length - MAX_DIFF_LINES} more lines). Open file to view full content.</div>
        </div>`
      : '';

    return `
<div class="file">
  <div class="file-header" onclick="toggleFile(this)">
    <span class="file-name untracked">
      <span class="toggle-icon">▼</span>
      ${escapeHtml(file.file)}
    </span>
    <div class="file-stats">
      <span class="file-badge untracked">new</span>
      <span class="stat additions">+${file.additions}</span>
      <button onclick="event.stopPropagation(); openFile('${escapeHtml(fullPath)}')">Open</button>
    </div>
  </div>
  <div class="diff-content">
    ${lines.join('')}
    ${truncationMessage}
  </div>
</div>`;
  }

  dispose(): void {
    if (this.activePanel) {
      this.activePanel.dispose();
      this.activePanel = undefined;
      this.currentRepo = undefined;
    }
  }
}
