import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceMode } from './workspace-mode';

const flag = vi.hoisted(() => ({ autoEnabled: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flag.autoEnabled, loading: false }),
}));

beforeEach(() => {
  window.localStorage.clear();
  flag.autoEnabled = true;
});

describe('workspace mode', () => {
  it('starts in Auto and remembers each choice per user', () => {
    createRoot((dispose) => {
      const workspace = createWorkspaceMode('user-a');
      expect(workspace.mode()).toBe('auto');
      workspace.setMode('code');
      dispose();
    });
    createRoot((dispose) => {
      const workspace = createWorkspaceMode('user-a');
      expect(workspace.mode()).toBe('code');
      expect(createWorkspaceMode('user-b').mode()).toBe('auto');
      workspace.setMode('chat');
      dispose();
    });
    createRoot((dispose) => {
      expect(createWorkspaceMode('user-a').mode()).toBe('chat');
      dispose();
    });
  });

  it('reads Auto as Chat without the flag and keeps an explicit Code', () => {
    flag.autoEnabled = false;
    window.localStorage.setItem('agents-view-mode-v1:user-b', 'code');
    createRoot((dispose) => {
      const workspace = createWorkspaceMode('user-a');
      expect(workspace.autoAvailable()).toBe(false);
      expect(workspace.mode()).toBe('chat');
      expect(createWorkspaceMode('user-b').mode()).toBe('code');
      dispose();
    });
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem('agents-view-mode-v1:user-a', 'agents');
    createRoot((dispose) => {
      expect(createWorkspaceMode('user-a').mode()).toBe('auto');
      dispose();
    });
  });
});
