import * as vscode from 'vscode';
import { DetectedRepo } from '../utils/repoDetector';

export class ConsolePanel {
  private activeTerminal: vscode.Terminal | undefined;
  private currentRepoPath: string | undefined;

  async openConsole(repo: DetectedRepo, inEditorArea: boolean = false): Promise<vscode.Terminal> {
    // Same repo - just show existing terminal
    if (this.activeTerminal && this.currentRepoPath === repo.path) {
      const isActive = vscode.window.terminals.includes(this.activeTerminal);
      if (isActive) {
        this.activeTerminal.show();
        return this.activeTerminal;
      }
    }

    // Different repo or no terminal - dispose old and create new
    if (this.activeTerminal) {
      this.activeTerminal.dispose();
    }

    // Create new terminal for selected repo
    const terminalOptions: vscode.TerminalOptions = {
      name: `${repo.name}`,
      cwd: repo.path,
      iconPath: new vscode.ThemeIcon('terminal'),
    };

    // If opening in editor area, use TerminalLocation.Editor
    if (inEditorArea) {
      (terminalOptions as vscode.TerminalOptions & { location: vscode.TerminalLocation }).location =
        vscode.TerminalLocation.Editor;
    }

    this.activeTerminal = vscode.window.createTerminal(terminalOptions);
    this.currentRepoPath = repo.path;
    this.activeTerminal.show();

    // Handle terminal close
    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.activeTerminal) {
        this.activeTerminal = undefined;
        this.currentRepoPath = undefined;
        disposable.dispose();
      }
    });

    return this.activeTerminal;
  }

  closeConsole(): void {
    if (this.activeTerminal) {
      this.activeTerminal.dispose();
      this.activeTerminal = undefined;
      this.currentRepoPath = undefined;
    }
  }

  closeAllConsoles(): void {
    this.closeConsole();
  }

  dispose(): void {
    this.closeConsole();
  }
}
