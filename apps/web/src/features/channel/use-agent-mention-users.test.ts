import {
  MACRO_AGENT_NAME,
  MACRO_AGENT_PRINCIPAL_ID,
} from '@core/constant/macroAgent';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { IUser } from '@core/user/types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentMentionUsers } from './use-agent-mention-users';

const flags = vi.hoisted(() => ({
  agents: (): boolean => false,
  cursor: (): boolean => false,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-chat-v3-agents' ? flags.agents() : flags.cursor(),
  }),
}));

function macroEntries(users: IUser[]): IUser[] {
  return users.filter((user) => user.name === MACRO_AGENT_NAME);
}

describe('useAgentMentionUsers', () => {
  beforeEach(() => {
    flags.agents = () => false;
    flags.cursor = () => false;
  });

  it('offers the classic Macro bot as the only Macro entry without the rollout', () => {
    createRoot((dispose) => {
      const users = useAgentMentionUsers(() => []);
      expect(macroEntries(users())).toEqual([
        {
          id: MACRO_AGENT_PRINCIPAL_ID,
          name: MACRO_AGENT_NAME,
          email: MACRO_AGENT_NAME,
        },
      ]);
      dispose();
    });
  });

  it('points the same entry at the agent bot within the rollout', () => {
    createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      flags.agents = enabled;
      const users = useAgentMentionUsers(() => []);
      expect(macroEntries(users()).map((user) => user.id)).toEqual([
        MACRO_AGENT_PRINCIPAL_ID,
      ]);
      setEnabled(true);
      expect(macroEntries(users()).map((user) => user.id)).toEqual([
        MACRO_NEW_PRINCIPAL_ID,
      ]);
      dispose();
    });
  });

  it('keeps one Macro entry when the other Macro bot is already in the list', () => {
    createRoot((dispose) => {
      flags.agents = () => true;
      const users = useAgentMentionUsers(() => [
        {
          id: MACRO_AGENT_PRINCIPAL_ID,
          name: 'Macro',
          email: 'Macro',
        },
        {
          id: MACRO_NEW_PRINCIPAL_ID,
          name: 'macro(new)',
          email: 'macro(new)',
        },
      ]);
      expect(macroEntries(users()).map((user) => user.id)).toEqual([
        MACRO_NEW_PRINCIPAL_ID,
      ]);
      dispose();
    });
  });
});
