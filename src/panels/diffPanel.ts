import * as vscode from 'vscode';
import { createHighlighter, Highlighter } from 'shiki';
import { DetectedRepo } from '../utils/repoDetector';
import { gitService, DiffFile, CommitInfo } from '../services/gitService';

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
  private highlighter: Highlighter | undefined;
  private loadedLangs: Set<string> = new Set();

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

  private getCurrentTheme(): 'github-light' | 'github-dark' {
    const themeKind = vscode.window.activeColorTheme.kind;
    return themeKind === vscode.ColorThemeKind.Light ? 'github-light' : 'github-dark';
  }

  private async getHighlighter(): Promise<Highlighter> {
    if (!this.highlighter) {
      this.highlighter = await createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [], // Start empty, load languages on demand
      });
    }
    return this.highlighter;
  }

  private async ensureLanguageLoaded(lang: string): Promise<void> {
    if (!this.highlighter || this.loadedLangs.has(lang)) {
      return;
    }
    try {
      await this.highlighter.loadLanguage(lang as Parameters<typeof this.highlighter.loadLanguage>[0]);
      this.loadedLangs.add(lang);
    } catch {
      // Language not supported, will fall back to plaintext
    }
  }

  private getLanguageFromFile(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'json': 'json',
      'css': 'css',
      'scss': 'css',
      'less': 'css',
      'html': 'html',
      'htm': 'html',
      'md': 'markdown',
      'markdown': 'markdown',
      'py': 'python',
      'java': 'java',
      'go': 'go',
      'rs': 'rust',
      'c': 'c',
      'h': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'scala': 'scala',
      'yml': 'yaml',
      'yaml': 'yaml',
      'toml': 'toml',
      'xml': 'xml',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
    };

    // Check for special filenames
    const basename = filename.split('/').pop()?.toLowerCase() || '';
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'makefile';

    return langMap[ext] || 'plaintext';
  }

  private async highlightCode(code: string, lang: string, highlighter: Highlighter): Promise<string[]> {
    // Ensure the language is loaded
    await this.ensureLanguageLoaded(lang);

    const theme = this.getCurrentTheme();
    const effectiveLang = this.loadedLangs.has(lang) ? lang : 'plaintext';

    try {
      // Highlight entire code block at once
      const html = highlighter.codeToHtml(code, { lang: effectiveLang, theme });

      // Extract the code content from <code>...</code>
      const codeMatch = html.match(/<code>([\s\S]*?)<\/code>/);
      if (!codeMatch) {
        // Fallback: escape each line
        return code.split('\n').map(line => this.escapeHtml(line));
      }

      const codeContent = codeMatch[1];

      // Shiki wraps each line in <span class="line">...</span>
      // Split by line spans to get individual highlighted lines
      const lineRegex = /<span class="line">([\s\S]*?)<\/span>/g;
      const lines: string[] = [];
      let match;

      while ((match = lineRegex.exec(codeContent)) !== null) {
        lines.push(match[1]);
      }

      // If no line spans found (shouldn't happen), fall back to splitting
      if (lines.length === 0) {
        return code.split('\n').map(line => this.escapeHtml(line));
      }

      return lines;
    } catch {
      // Fallback: escape each line
      return code.split('\n').map(line => this.escapeHtml(line));
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

    panel.webview.html = await this.getWebviewContent(repo, diffData);
  }

  private async getWebviewContent(repo: DetectedRepo, data: DiffData): Promise<string> {
    const hasUncommittedChanges =
      data.staged.length > 0 ||
      data.unstaged.length > 0 ||
      data.untracked.length > 0;

    const totalUncommittedFiles =
      data.staged.length + data.unstaged.length + data.untracked.length;

    // Get the highlighter once for all files
    const highlighter = await this.getHighlighter();

    const stagedHtml = (await Promise.all(
      data.staged.map((file) => this.renderFileDiff(file, repo.path, 'staged', highlighter))
    )).join('');

    const unstagedHtml = (await Promise.all(
      data.unstaged.map((file) => this.renderFileDiff(file, repo.path, 'unstaged', highlighter))
    )).join('');

    const untrackedHtml = (await Promise.all(
      data.untracked.map((file) => this.renderUntrackedFile(file, repo.path, highlighter))
    )).join('');

    const branchDiffHtml = (await Promise.all(
      data.branchDiff.map((file) => this.renderFileDiff(file, repo.path, 'branch', highlighter))
    )).join('');

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

    /* Shiki syntax highlighting overrides */
    .diff-line span.line { display: inline; }
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

  private async renderFileDiff(
    file: DiffFile,
    repoPath: string,
    type: 'staged' | 'unstaged' | 'branch',
    highlighter: Highlighter
  ): Promise<string> {
    const fullPath = `${repoPath}/${file.file}`;
    const lines = file.diff.split('\n');
    const lang = this.getLanguageFromFile(file.file);

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
      ? await this.highlightCode(codeLines.join('\n'), lang, highlighter)
      : [];

    // Third pass: combine metadata with highlighted output
    let codeIndex = 0;
    const diffLines = linesMeta.map((meta) => {
      if (meta.type === 'hunk') {
        return `<div class="diff-line-wrapper hunk">
          <span class="line-numbers"><span class="line-number old"></span><span class="line-number new"></span></span>
          <div class="diff-line hunk">${this.escapeHtml(meta.rawLine)}</div>
        </div>`;
      }

      const highlighted = highlightedLines[codeIndex++] || this.escapeHtml(meta.code);

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
    ${diffLines.join('')}
  </div>
</div>`;
  }

  private async renderUntrackedFile(file: DiffFile, repoPath: string, highlighter: Highlighter): Promise<string> {
    const fullPath = `${repoPath}/${file.file}`;
    const lang = this.getLanguageFromFile(file.file);
    const fileContent = file.diff;

    // Highlight entire file content at once
    const highlightedLines = await this.highlightCode(fileContent, lang, highlighter);

    // Build HTML for each line with pre-computed line numbers
    const lines = highlightedLines.map((highlighted, index) => {
      const lineNum = index + 1;
      return `<div class="diff-line-wrapper addition">
        <span class="line-numbers"><span class="line-number old"></span><span class="line-number new">${lineNum}</span></span>
        <div class="diff-line addition"><span class="diff-marker">+</span>${highlighted}</div>
      </div>`;
    });

    return `
<div class="file">
  <div class="file-header" onclick="toggleFile(this)">
    <span class="file-name untracked">
      <span class="toggle-icon">▼</span>
      ${this.escapeHtml(file.file)}
    </span>
    <div class="file-stats">
      <span class="file-badge untracked">new</span>
      <span class="stat additions">+${file.additions}</span>
      <button onclick="event.stopPropagation(); openFile('${this.escapeHtml(fullPath)}')">Open</button>
    </div>
  </div>
  <div class="diff-content">
    ${lines.join('')}
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
