import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceMode } from './workspace-mode';

beforeEach(() => window.localStorage.clear());

describe('workspace mode', () => {
  it('starts in Work and remembers Code per user', () => {
    createRoot((dispose) => {
      const workspace = createWorkspaceMode('user-a');
      expect(workspace.mode()).toBe('chat');
      workspace.setMode('code');
      dispose();
    });
    createRoot((dispose) => {
      expect(createWorkspaceMode('user-a').mode()).toBe('code');
      expect(createWorkspaceMode('user-b').mode()).toBe('chat');
      dispose();
    });
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem('agents-view-mode-v1:user-a', 'agents');
    createRoot((dispose) => {
      expect(createWorkspaceMode('user-a').mode()).toBe('chat');
      dispose();
    });
  });
});
