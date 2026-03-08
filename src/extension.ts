import * as vscode from 'vscode';
import { RepoTreeProvider } from './providers/repoTreeProvider';
import { RepoItem } from './providers/repoItem';
import { ConsolePanel } from './panels/consolePanel';
import { DiffPanel } from './panels/diffPanel';

let consolePanel: ConsolePanel;
let diffPanel: DiffPanel;

export function activate(context: vscode.ExtensionContext) {
  // Initialize panels
  consolePanel = new ConsolePanel();
  diffPanel = new DiffPanel();

  // Initialize tree provider
  const repoTreeProvider = new RepoTreeProvider(context);

  // Register tree view
  const treeView = vscode.window.createTreeView('code-review.repos', {
    treeDataProvider: repoTreeProvider,
    showCollapseAll: false,
  });

  // Handle tree view selection - open both terminal and diff panel
  treeView.onDidChangeSelection(async (e) => {
    if (e.selection.length > 0) {
      const item = e.selection[0];
      if (item?.repo) {
        await openRepoView(item);
      }
    }
  });

  // Function to open both terminal (left) and diff panel (right)
  async function openRepoView(item: RepoItem) {
    // Open terminal in editor area (left side - ViewColumn.One)
    await consolePanel.openConsole(item.repo, true);

    // Small delay to ensure terminal is created first
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Open diff panel on the right side (ViewColumn.Two)
    await diffPanel.showDiff(item.repo, vscode.ViewColumn.Two);
  }

  // Register commands
  const addRepoCommand = vscode.commands.registerCommand(
    'code-review.addRepo',
    () => repoTreeProvider.addRepo()
  );

  const removeRepoCommand = vscode.commands.registerCommand(
    'code-review.removeRepo',
    (item: RepoItem) => repoTreeProvider.removeRepo(item)
  );

  const refreshCommand = vscode.commands.registerCommand(
    'code-review.refresh',
    () => repoTreeProvider.refresh()
  );

  const openConsoleCommand = vscode.commands.registerCommand(
    'code-review.openConsole',
    (item: RepoItem) => {
      if (item?.repo) {
        consolePanel.openConsole(item.repo);
      }
    }
  );

  const showDiffCommand = vscode.commands.registerCommand(
    'code-review.showDiff',
    async (item: RepoItem) => {
      if (item?.repo) {
        await diffPanel.showDiff(item.repo, vscode.ViewColumn.One);
      }
    }
  );

  // Command to open both panels side by side
  const openRepoCommand = vscode.commands.registerCommand(
    'code-review.openRepo',
    async (item: RepoItem) => {
      if (item?.repo) {
        await openRepoView(item);
      }
    }
  );

  // Watch for workspace folder changes
  const workspaceFolderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    repoTreeProvider.refresh();
  });

  // Register disposables
  context.subscriptions.push(
    treeView,
    addRepoCommand,
    removeRepoCommand,
    refreshCommand,
    openConsoleCommand,
    showDiffCommand,
    openRepoCommand,
    workspaceFolderWatcher,
    {
      dispose: () => {
        consolePanel.dispose();
        diffPanel.dispose();
      },
    }
  );
}

export function deactivate() {
  if (consolePanel) {
    consolePanel.dispose();
  }
  if (diffPanel) {
    diffPanel.dispose();
  }
}
