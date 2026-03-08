import * as vscode from 'vscode';
import { DetectedRepo } from '../utils/repoDetector';

export class ConsolePanel {
  private terminals: Map<string, vscode.Terminal> = new Map();
  private currentRepoPath: string | undefined;

  async openConsole(repo: DetectedRepo, inEditorArea: boolean = false): Promise<vscode.Terminal> {
    // Check if we already have a terminal for this repo
    const existingTerminal = this.terminals.get(repo.path);
    if (existingTerminal && vscode.window.terminals.includes(existingTerminal)) {
      this.currentRepoPath = repo.path;
      existingTerminal.show();
      return existingTerminal;
    }

    // Create new terminal for this repo
    const terminalOptions: vscode.TerminalOptions = {
      name: `${repo.name}`,
      cwd: repo.path,
      iconPath: new vscode.ThemeIcon('terminal'),
    };

    if (inEditorArea) {
      (terminalOptions as vscode.TerminalOptions & { location: vscode.TerminalEditorLocationOptions }).location = {
        viewColumn: vscode.ViewColumn.One,
      };
    }

    const terminal = vscode.window.createTerminal(terminalOptions);
    this.terminals.set(repo.path, terminal);
    this.currentRepoPath = repo.path;
    terminal.show();

    // Clean up when terminal is closed
    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      for (const [path, t] of this.terminals.entries()) {
        if (t === closed) {
          this.terminals.delete(path);
          if (this.currentRepoPath === path) {
            this.currentRepoPath = undefined;
          }
          disposable.dispose();
          break;
        }
      }
    });

    return terminal;
  }

  closeConsole(repoPath?: string): void {
    if (repoPath) {
      const terminal = this.terminals.get(repoPath);
      if (terminal) {
        terminal.dispose();
        this.terminals.delete(repoPath);
      }
    } else if (this.currentRepoPath) {
      const terminal = this.terminals.get(this.currentRepoPath);
      if (terminal) {
        terminal.dispose();
        this.terminals.delete(this.currentRepoPath);
      }
      this.currentRepoPath = undefined;
    }
  }

  closeAllConsoles(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
    this.currentRepoPath = undefined;
  }

  getTerminal(repoPath: string): vscode.Terminal | undefined {
    return this.terminals.get(repoPath);
  }

  dispose(): void {
    this.closeAllConsoles();
  }
}
