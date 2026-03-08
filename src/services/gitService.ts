import simpleGit, { SimpleGit } from 'simple-git';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface DiffFile {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
}

export class GitService {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  async isGitRepo(path: string): Promise<boolean> {
    try {
      const git = this.getGit(path);
      await git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async hasCommits(repoPath: string): Promise<boolean> {
    try {
      const git = this.getGit(repoPath);
      await git.revparse(['HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);

    // Check if repo has any commits
    if (!(await this.hasCommits(repoPath))) {
      // Try to get branch from HEAD file for repos with no commits
      try {
        const head = await git.raw(['symbolic-ref', '--short', 'HEAD']);
        return head.trim();
      } catch {
        return 'main';
      }
    }

    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);

    // Check if 'main' exists
    try {
      await git.revparse(['--verify', 'main']);
      return 'main';
    } catch {
      // main doesn't exist
    }

    // Check if 'master' exists
    try {
      await git.revparse(['--verify', 'master']);
      return 'master';
    } catch {
      // master doesn't exist
    }

    // Try to get from remote
    try {
      const remotes = await git.remote(['show', 'origin']);
      if (remotes) {
        const match = remotes.match(/HEAD branch: (\S+)/);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // No remote or can't determine
    }

    // Default fallback
    return 'main';
  }

  async getDiffAgainstDefault(repoPath: string): Promise<DiffFile[]> {
    const git = this.getGit(repoPath);
    const defaultBranch = await this.getDefaultBranch(repoPath);

    try {
      // Get the merge base to find common ancestor
      const mergeBase = await git.raw(['merge-base', defaultBranch, 'HEAD']);
      const base = mergeBase.trim();

      // Get diff from merge base to HEAD
      const diffOutput = await git.diff([base, 'HEAD']);
      const diffStat = await git.diff([base, 'HEAD', '--stat']);

      return this.parseDiff(diffOutput, diffStat);
    } catch (error) {
      // If merge-base fails, try direct diff
      try {
        const diffOutput = await git.diff([`${defaultBranch}...HEAD`]);
        const diffStat = await git.diff([`${defaultBranch}...HEAD`, '--stat']);
        return this.parseDiff(diffOutput, diffStat);
      } catch {
        return [];
      }
    }
  }

  async getRawDiff(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);
    const defaultBranch = await this.getDefaultBranch(repoPath);

    try {
      const mergeBase = await git.raw(['merge-base', defaultBranch, 'HEAD']);
      const base = mergeBase.trim();
      return await git.diff([base, 'HEAD']);
    } catch {
      try {
        return await git.diff([`${defaultBranch}...HEAD`]);
      } catch {
        return '';
      }
    }
  }

  private parseDiff(diffOutput: string, _diffStat: string): DiffFile[] {
    const files: DiffFile[] = [];
    const fileDiffs = diffOutput.split(/^diff --git /m).filter(Boolean);

    for (const fileDiff of fileDiffs) {
      const lines = fileDiff.split('\n');
      const headerMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
      if (!headerMatch) continue;

      const file = headerMatch[2];
      let additions = 0;
      let deletions = 0;

      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }

      files.push({
        file,
        additions,
        deletions,
        diff: 'diff --git ' + fileDiff,
      });
    }

    return files;
  }

  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const git = this.getGit(repoPath);

    try {
      const output = await git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeInfo[] = [];
      const entries = output.split('\n\n').filter(Boolean);

      for (const entry of entries) {
        const lines = entry.split('\n');
        let path = '';
        let branch = '';
        let isMain = false;

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.substring(9);
          } else if (line.startsWith('branch ')) {
            branch = line.substring(7).replace('refs/heads/', '');
          } else if (line === 'bare') {
            isMain = true;
          }
        }

        if (path) {
          worktrees.push({ path, branch, isMain });
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  async getRepoName(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath);

    try {
      // Try to get name from remote URL
      const remoteUrl = await git.remote(['get-url', 'origin']);
      if (remoteUrl) {
        const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // No remote
    }

    // Fall back to directory name
    const parts = repoPath.split('/');
    return parts[parts.length - 1] || 'Unknown';
  }

  async hasChanges(repoPath: string): Promise<boolean> {
    try {
      const git = this.getGit(repoPath);
      const status = await git.status();
      return !status.isClean();
    } catch {
      return false;
    }
  }

  async getStatus(repoPath: string): Promise<{
    staged: number;
    modified: number;
    untracked: number;
  }> {
    try {
      const git = this.getGit(repoPath);
      const status = await git.status();

      return {
        staged: status.staged.length,
        modified: status.modified.length + status.deleted.length,
        untracked: status.not_added.length,
      };
    } catch {
      return {
        staged: 0,
        modified: 0,
        untracked: 0,
      };
    }
  }

  async getUnstagedDiff(repoPath: string): Promise<DiffFile[]> {
    const git = this.getGit(repoPath);

    try {
      // Get diff of working directory (unstaged changes)
      const diffOutput = await git.diff();
      return this.parseDiff(diffOutput, '');
    } catch {
      return [];
    }
  }

  async getStagedDiff(repoPath: string): Promise<DiffFile[]> {
    const git = this.getGit(repoPath);

    try {
      // Get diff of staged changes
      const diffOutput = await git.diff(['--cached']);
      return this.parseDiff(diffOutput, '');
    } catch {
      return [];
    }
  }

  async getUntrackedFiles(repoPath: string): Promise<string[]> {
    try {
      const git = this.getGit(repoPath);
      const status = await git.status();
      return status.not_added;
    } catch {
      return [];
    }
  }

  async commitAll(repoPath: string, message: string): Promise<void> {
    const git = this.getGit(repoPath);

    // Stage all changes including untracked files
    await git.add(['-A']);

    // Commit
    await git.commit(message);
  }
}

export const gitService = new GitService();
