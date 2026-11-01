import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceMode } from './workspace-mode';

const flag = vi.hoisted(() => ({ autoEnabled: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flag.autoEnabled, loading: false }),
}));

beforeEach(() => {
  flag.autoEnabled = true;
});

describe('workspace mode', () => {
  it('opens every composer in Auto, whatever was chosen before', () => {
    createRoot((dispose) => {
      const workspace = createWorkspaceMode();
      expect(workspace.mode()).toBe('auto');
      workspace.setMode('code');
      expect(workspace.mode()).toBe('code');
      dispose();
    });
    createRoot((dispose) => {
      expect(createWorkspaceMode().mode()).toBe('auto');
      dispose();
    });
  });

  it('reads Auto as Chat without the flag and keeps an explicit Code', () => {
    flag.autoEnabled = false;
    createRoot((dispose) => {
      const workspace = createWorkspaceMode();
      expect(workspace.autoAvailable()).toBe(false);
      expect(workspace.mode()).toBe('chat');
      workspace.setMode('code');
      expect(workspace.mode()).toBe('code');
      dispose();
    });
  });
});
