import { CODEX_BOT_PRINCIPAL_ID } from '@core/constant/codexAgent';
import {
  MACRO_AGENT_NAME,
  MACRO_AGENT_PRINCIPAL_ID,
} from '@core/constant/macroAgent';
import {
  MACRO_CODER_BOT_ID,
  MACRO_CODER_NAME,
  MACRO_CODER_PRINCIPAL_ID,
} from '@core/constant/macroCoder';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { IUser } from '@core/user/types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codexMentionUser } from './macroAi';
import { useAgentMentionUsers } from './use-agent-mention-users';

const flags = vi.hoisted(() => ({
  codex: (): boolean => false,
  cursor: (): boolean => false,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCodexAgents: { key: 'enable-codex-agents' },
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-codex-agents' ? flags.codex() : flags.cursor(),
  }),
}));

function macroEntries(users: IUser[]): IUser[] {
  return users.filter((user) => user.name === MACRO_AGENT_NAME);
}

describe('useAgentMentionUsers', () => {
  beforeEach(() => {
    flags.codex = () => false;
    flags.cursor = () => false;
  });

  it('offers Codex only within the Codex rollout, even when it is a participant', () => {
    createRoot((dispose) => {
      const [codex, setCodex] = createSignal(false);
      flags.codex = codex;
      const users = useAgentMentionUsers(() => [codexMentionUser()]);
      const codexIds = () =>
        users()
          .map((user) => user.id)
          .filter((id) => id === CODEX_BOT_PRINCIPAL_ID);
      expect(codexIds()).toEqual([]);
      setCodex(true);
      expect(codexIds()).toEqual([CODEX_BOT_PRINCIPAL_ID]);
      dispose();
    });
  });

  it('offers the agent bot as the only Macro entry', () => {
    createRoot((dispose) => {
      const users = useAgentMentionUsers(() => []);
      expect(macroEntries(users())).toEqual([
        {
          id: MACRO_NEW_PRINCIPAL_ID,
          name: MACRO_AGENT_NAME,
          email: MACRO_AGENT_NAME,
        },
      ]);
      dispose();
    });
  });

  it('keeps one Macro entry when the other Macro bot is already in the list', () => {
    createRoot((dispose) => {
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

  it('excludes the retired coder', () => {
    createRoot((dispose) => {
      const users = useAgentMentionUsers(() => []);
      expect(users().map((user) => user.id)).not.toContain(
        MACRO_CODER_PRINCIPAL_ID
      );

      const person = {
        id: 'person',
        name: 'Person',
        email: 'person@example.com',
      };
      const [enabled, setEnabled] = createSignal(true);
      const participants = [
        person,
        ...[MACRO_CODER_BOT_ID, MACRO_CODER_PRINCIPAL_ID].map((id) => ({
          id,
          name: MACRO_CODER_NAME,
          email: MACRO_CODER_NAME,
        })),
      ];
      const mentions = useAgentMentionUsers(() => participants, enabled);
      expect(mentions()).toContainEqual(person);
      expect(mentions().map((user) => user.id)).not.toContain(
        MACRO_CODER_BOT_ID
      );
      expect(mentions().map((user) => user.id)).not.toContain(
        MACRO_CODER_PRINCIPAL_ID
      );
      setEnabled(false);
      expect(mentions()).toEqual([person]);
      expect(participants).toHaveLength(3);
      dispose();
    });
  });
});
