import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useCodexAgentsAccess } from './flag';

const flags = vi.hoisted(() => ({
  codex: (): boolean => false,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCodexAgents: { key: 'enable-codex-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flags.codex() }),
}));

describe('Codex access', () => {
  it('follows the Codex rollout and responds to flag changes', () => {
    createRoot((dispose) => {
      const [codex, setCodex] = createSignal(false);
      flags.codex = codex;
      const access = useCodexAgentsAccess();
      expect(access()).toBe(false);
      setCodex(true);
      expect(access()).toBe(true);
      setCodex(false);
      expect(access()).toBe(false);
      dispose();
    });
  });
});
