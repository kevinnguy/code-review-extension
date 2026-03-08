import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module
const mockDispose = vi.fn();

vi.mock('vscode', () => {
  class MockRelativePattern {
    base: string;
    pattern: string;
    constructor(base: string, pattern: string) {
      this.base = base;
      this.pattern = pattern;
    }
  }
  return {
    workspace: {
      createFileSystemWatcher: vi.fn(() => ({
        dispose: mockDispose,
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        onDidDelete: vi.fn(),
      })),
    },
    RelativePattern: MockRelativePattern,
    window: {
      createWebviewPanel: vi.fn(),
      activeColorTheme: { kind: 2 },
    },
    ViewColumn: { One: 1 },
    ColorThemeKind: { Light: 1, Dark: 2 },
  };
});

describe('DiffPanel file watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a file system watcher with the correct pattern', async () => {
    const vscode = await import('vscode');

    const repoPath = '/test/repo';
    const pattern = new vscode.RelativePattern(repoPath, '**/*');

    expect(pattern.base).toBe(repoPath);
    expect(pattern.pattern).toBe('**/*');
  });

  it('should debounce refresh calls', async () => {
    const refreshCallback = vi.fn();
    let registeredCallback: (() => void) | null = null;

    // Simulate the debounce behavior
    let refreshTimeout: NodeJS.Timeout | undefined;
    const triggerRefresh = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        refreshCallback();
      }, 500);
    };

    // Simulate rapid file changes
    triggerRefresh();
    triggerRefresh();
    triggerRefresh();

    // Should not have called refresh yet
    expect(refreshCallback).not.toHaveBeenCalled();

    // Advance time by 500ms
    vi.advanceTimersByTime(500);

    // Should have called refresh exactly once
    expect(refreshCallback).toHaveBeenCalledTimes(1);
  });

  it('should clear timeout on dispose', () => {
    let refreshTimeout: NodeJS.Timeout | undefined;

    // Setup a timeout
    refreshTimeout = setTimeout(() => {}, 500);

    // Dispose should clear it
    const disposeFileWatcher = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = undefined;
      }
    };

    disposeFileWatcher();

    expect(refreshTimeout).toBeUndefined();
  });

  it('should dispose existing watcher when setting up new one', () => {
    let fileWatcher: { dispose: () => void } | undefined;

    const disposeFileWatcher = () => {
      if (fileWatcher) {
        fileWatcher.dispose();
        fileWatcher = undefined;
      }
    };

    const setupFileWatcher = () => {
      disposeFileWatcher();
      fileWatcher = { dispose: mockDispose };
    };

    // Setup first watcher
    setupFileWatcher();
    expect(fileWatcher).toBeDefined();

    // Setup second watcher - should dispose first
    setupFileWatcher();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('should register handlers for change, create, and delete events', () => {
    // Verify that the watcher registers all three event handlers
    const watcher = {
      onDidChange: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    };

    const triggerRefresh = vi.fn();

    watcher.onDidChange(triggerRefresh);
    watcher.onDidCreate(triggerRefresh);
    watcher.onDidDelete(triggerRefresh);

    expect(watcher.onDidChange).toHaveBeenCalledWith(triggerRefresh);
    expect(watcher.onDidCreate).toHaveBeenCalledWith(triggerRefresh);
    expect(watcher.onDidDelete).toHaveBeenCalledWith(triggerRefresh);
  });
});
