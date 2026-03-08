# Code Review

A VS Code extension for streamlined code review workflows with repository management, integrated terminals, and diff viewing.

## Features

### Repository Management

- **Auto-detection**: Automatically discovers Git repositories in your workspace folders
- **Manual addition**: Add repositories from any path on your system
- **Worktree support**: Detects and displays Git worktrees alongside regular repositories
- **Status indicators**: Shows current branch and file status counts (+staged, ~modified, ?untracked)
- **Persistent storage**: Manually added repositories are saved across sessions

### Integrated Terminal

- **Per-repository terminals**: Creates isolated terminal sessions for each repository
- **Multi-terminal support**: Work with multiple repos simultaneously
- **Editor-integrated view**: Display terminals alongside your code for side-by-side workflows

### Diff Viewing & Code Review

- **Staged changes**: View files with staged modifications
- **Unstaged changes**: See working directory modifications
- **Untracked files**: View new files not yet tracked by Git with content preview
- **Branch comparison**: Compare your changes against the default branch (main/master)
- **Unpushed commits**: See commits that haven't been pushed to remote
- **Interactive diffs**: Collapsible file diffs with syntax highlighting
- **Quick file access**: Open any file directly from the diff view

### Git Operations

- **Commit all**: Quickly commit all staged and unstaged changes with a message
- **Push to remote**: Push commits directly from the diff panel
- **Real-time status**: Automatic updates as you make changes

## Installation

### From VSIX (Local)

1. Build the extension (see [Running Locally](#running-locally))
2. Package it: `npx vsce package`
3. In VS Code, go to Extensions > ... > Install from VSIX
4. Select the generated `.vsix` file

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [VS Code](https://code.visualstudio.com/) (v1.85.0 or higher)
- Git installed and available in your PATH

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/code-review.git
   cd code-review
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the TypeScript:
   ```bash
   npm run compile
   ```

### Running in Debug Mode

1. Open the project in VS Code:
   ```bash
   code .
   ```

2. Press `F5` to launch the Extension Development Host

3. A new VS Code window will open with the extension loaded

### Development with Watch Mode

For active development, use watch mode to automatically recompile on changes:

```bash
npm run watch
```

Then press `F5` in VS Code to start debugging. The extension will reload when you make changes (you may need to reload the development host window).

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch for changes and recompile automatically |
| `npm run lint` | Run ESLint on the source code |
| `npm run vscode:prepublish` | Compile for production (used when packaging) |

## Usage

### Getting Started

1. Open VS Code with a workspace containing Git repositories
2. Click the **Code Review** icon in the Activity Bar (left sidebar)
3. Your repositories will be automatically detected and displayed

### Adding Repositories

- Click the **+** button in the Repositories view header
- Or right-click and select **Add Repository**
- Browse to select a Git repository folder

### Reviewing Code

1. Click on a repository to open both the terminal and diff panel
2. Or right-click a repository and choose:
   - **Open Console** - Opens just the terminal
   - **Show Diff** - Opens just the diff panel
   - **Open Repository** - Opens both side-by-side

### Diff Panel Sections

- **Staged** - Files added to the staging area
- **Unstaged** - Modified files not yet staged
- **Untracked** - New files not tracked by Git
- **Against Default Branch** - All changes compared to main/master
- **Unpushed Commits** - Commits not yet pushed to remote

### Committing Changes

1. Enter your commit message in the input field at the top of the diff panel
2. Click **Commit All** to stage and commit all changes
3. Click **Push** to push commits to the remote repository

## Extension Commands

| Command | Description |
|---------|-------------|
| `Code Review: Add Repository` | Add a repository manually |
| `Code Review: Remove Repository` | Remove a repository from the list |
| `Code Review: Refresh` | Refresh the repository list |
| `Code Review: Open Console` | Open terminal for selected repository |
| `Code Review: Show Diff` | Open diff panel for selected repository |
| `Code Review: Open Repository` | Open both console and diff panel |

## Project Structure

```
code-review/
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── providers/
│   │   ├── repoTreeProvider.ts # Repository tree view
│   │   └── repoItem.ts        # Tree item model
│   ├── panels/
│   │   ├── consolePanel.ts    # Terminal management
│   │   └── diffPanel.ts       # Diff webview panel
│   ├── services/
│   │   └── gitService.ts      # Git operations
│   └── utils/
│       └── repoDetector.ts    # Repository detection
├── out/                       # Compiled JavaScript
├── package.json               # Extension manifest
└── tsconfig.json              # TypeScript configuration
```

## Requirements

- VS Code 1.85.0 or higher
- Git installed and accessible from command line
- Node.js 16+ (for development only)

## License

MIT License - see [LICENSE](LICENSE) for details.
