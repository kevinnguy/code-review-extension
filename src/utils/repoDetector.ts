import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { gitService, WorktreeInfo } from '../services/gitService';

export interface DetectedRepo {
  path: string;
  name: string;
  branch: string;
  isWorktree: boolean;
  worktrees?: WorktreeInfo[];
}

export async function detectReposInWorkspace(): Promise<DetectedRepo[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return [];
  }

  const repos: DetectedRepo[] = [];
  const seenPaths = new Set<string>();

  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;

    // Check if the folder itself is a git repo
    if (await gitService.isGitRepo(folderPath)) {
      if (!seenPaths.has(folderPath)) {
        seenPaths.add(folderPath);
        const repo = await createDetectedRepo(folderPath);
        repos.push(repo);

        // Also check for worktrees
        const worktrees = await gitService.listWorktrees(folderPath);
        for (const worktree of worktrees) {
          if (!seenPaths.has(worktree.path) && worktree.path !== folderPath) {
            seenPaths.add(worktree.path);
            repos.push({
              path: worktree.path,
              name: await gitService.getRepoName(worktree.path),
              branch: worktree.branch,
              isWorktree: true,
            });
          }
        }
      }
    } else {
      // Search for git repos in immediate subdirectories
      const subRepos = await findGitReposInDirectory(folderPath, 1);
      for (const repoPath of subRepos) {
        if (!seenPaths.has(repoPath)) {
          seenPaths.add(repoPath);
          const repo = await createDetectedRepo(repoPath);
          repos.push(repo);
        }
      }
    }
  }

  return repos;
}

async function createDetectedRepo(repoPath: string): Promise<DetectedRepo> {
  const [name, branch, worktrees] = await Promise.all([
    gitService.getRepoName(repoPath),
    gitService.getCurrentBranch(repoPath),
    gitService.listWorktrees(repoPath),
  ]);

  return {
    path: repoPath,
    name,
    branch,
    isWorktree: false,
    worktrees: worktrees.length > 1 ? worktrees : undefined,
  };
}

async function findGitReposInDirectory(
  dir: string,
  maxDepth: number
): Promise<string[]> {
  if (maxDepth < 0) {
    return [];
  }

  const repos: string[] = [];

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (await gitService.isGitRepo(fullPath)) {
        repos.push(fullPath);
      } else if (maxDepth > 0) {
        const subRepos = await findGitReposInDirectory(fullPath, maxDepth - 1);
        repos.push(...subRepos);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return repos;
}

export async function validateRepoPath(repoPath: string): Promise<boolean> {
  try {
    const exists = fs.existsSync(repoPath);
    if (!exists) {
      return false;
    }

    return await gitService.isGitRepo(repoPath);
  } catch {
    return false;
  }
}
