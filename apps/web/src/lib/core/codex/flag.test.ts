import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useCodexAgentsAccess } from './flag';

const flags = vi.hoisted(() => ({
  agents: (): boolean => false,
  codex: (): boolean => false,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
  enableCodexAgents: { key: 'enable-codex-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-chat-v3-agents' ? flags.agents() : flags.codex(),
  }),
}));

describe('Codex access', () => {
  it('requires both rollouts and responds to flag changes', () => {
    createRoot((dispose) => {
      const [agents, setAgents] = createSignal(false);
      const [codex, setCodex] = createSignal(false);
      flags.agents = agents;
      flags.codex = codex;
      const access = useCodexAgentsAccess();
      expect(access()).toBe(false);
      setCodex(true);
      expect(access()).toBe(false);
      setAgents(true);
      expect(access()).toBe(true);
      setCodex(false);
      expect(access()).toBe(false);
      dispose();
    });
  });
});
