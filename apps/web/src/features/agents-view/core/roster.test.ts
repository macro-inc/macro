import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { describe, expect, it } from 'vitest';
import {
  buildAgentRoster,
  kindForBot,
  MACRO_PERSONA_ID,
  type PersistedAgentLike,
  type RosterInput,
  rosterForAgentPicker,
} from './roster';

function persisted(
  overrides: Partial<PersistedAgentLike> & { harness: string }
): PersistedAgentLike {
  return {
    bot: {
      id: `bot-${overrides.harness}`,
      name: 'Agent',
      handle: 'agent',
      owner: { type: 'user', user_id: 'macro|me@example.com' },
    },
    default_model: 'claude-sonnet-5',
    ...overrides,
  };
}

const EMPTY: RosterInput = {
  agents: [],
  runtimes: [],
  cursorConnected: false,
  cursorNeedsConnection: true,
};

describe('buildAgentRoster', () => {
  it('leads with the first-party agents and coders', () => {
    const roster = buildAgentRoster(EMPTY);
    expect(roster.map((agent) => [agent.id, agent.kind])).toEqual([
      [MACRO_PERSONA_ID, 'agent'],
      [CURSOR_BOT_ID, 'coder'],
    ]);
    expect(roster[0]?.botId).toBeUndefined();
    expect(roster.every((agent) => agent.share === 'system')).toBe(true);
  });

  it('offers to connect Cursor until it is connected', () => {
    const cursor = buildAgentRoster(EMPTY).find((a) => a.id === CURSOR_BOT_ID);
    expect(cursor?.unavailableReason).toBe('Connect Cursor to start it');
    expect(cursor?.connectLabel).toBe('Connect Cursor');
    expect(cursor?.runtime.connected).toBe(false);

    const connected = buildAgentRoster({
      ...EMPTY,
      cursorConnected: true,
      cursorNeedsConnection: false,
      cursorDefaultModel: 'gpt-5',
    }).find((a) => a.id === CURSOR_BOT_ID);
    expect(connected?.unavailableReason).toBeUndefined();
    expect(connected?.connectLabel).toBeUndefined();
    expect(connected?.defaultModel).toBe('gpt-5');
  });

  it('classifies saved agents by harness and reads their runtime', () => {
    const roster = buildAgentRoster({
      ...EMPTY,
      cursorConnected: true,
      runtimes: [{ id: 'h1', name: 'wolf-laptop', connected: false }],
      agents: [
        persisted({ harness: 'in-memory' }),
        persisted({
          harness: 'cursor',
          bot: {
            id: 'bot-cursor',
            name: 'Reviewer',
            handle: 'reviewer',
            owner: { type: 'team', team_id: 't1' },
          },
        }),
        persisted({ harness: 'macrod', harness_id: 'h1' }),
        persisted({ harness: 'macrod', harness_id: 'gone' }),
      ],
    });
    const saved = roster.slice(2);
    expect(saved.map((agent) => agent.kind)).toEqual([
      'agent',
      'coder',
      'coder',
      'coder',
    ]);
    expect(saved[0]?.runtime).toEqual({ label: 'Macro', connected: true });
    expect(saved[0]?.unavailableReason).toBeUndefined();
    expect(saved[1]?.share).toBe('team');
    expect(saved[1]?.runtime).toEqual({ label: 'Cursor', connected: true });
    expect(saved[2]?.runtime).toEqual({
      label: 'wolf-laptop',
      connected: false,
    });
    expect(saved[2]?.unavailableReason).toBe('Its runtime is disconnected');
    expect(saved[3]?.runtime.label).toBe('Disconnected runtime');
  });

  it('cannot start a saved agent on a connected macrod runtime from here', () => {
    const roster = buildAgentRoster({
      ...EMPTY,
      runtimes: [{ id: 'h1', name: 'wolf-laptop', connected: true }],
      agents: [persisted({ harness: 'macrod', harness_id: 'h1' })],
    });
    expect(roster.at(-1)?.unavailableReason).toBe(
      'Runs on its own machine · start it from a channel mention'
    );
  });
});

describe('rosterForAgentPicker and kindForBot', () => {
  const roster = buildAgentRoster({
    ...EMPTY,
    agents: [
      persisted({ harness: 'in-memory' }),
      persisted({ harness: 'cursor' }),
      persisted({ harness: 'macrod' }),
      persisted({ harness: 'sandbox' }),
      persisted({ harness: 'claude-cloud' }),
      persisted({ harness: 'codex-cloud' }),
      persisted({ harness: 'future-runtime' }),
      persisted({
        harness: 'in-memory',
        bot: { id: MACRO_AGENT_BOT_ID, name: 'Macro', handle: 'macro' },
      }),
      persisted({
        harness: 'in-memory',
        bot: {
          id: `bot|${MACRO_AGENT_BOT_ID}`,
          name: 'Macro',
          handle: 'macro',
        },
      }),
      persisted({
        harness: 'in-memory',
        bot: { id: 'saved-macro-name', name: 'Macro', handle: 'my-macro' },
      }),
    ],
  });

  it('includes every runtime and excludes only the built-in Macro identity', () => {
    expect(rosterForAgentPicker(roster).map((a) => a.id)).toEqual([
      CURSOR_BOT_ID,
      'bot-in-memory',
      'bot-cursor',
      'bot-macrod',
      'bot-sandbox',
      'bot-claude-cloud',
      'bot-codex-cloud',
      'bot-future-runtime',
      'saved-macro-name',
    ]);
  });

  it.each(['claude-cloud', 'codex-cloud', 'future-runtime'])(
    'does not block an agent just because its runtime is %s',
    (harness) => {
      const agent = roster.find((entry) => entry.harness === harness);
      expect(agent?.unavailableReason).toBeUndefined();
      expect(agent?.runtime.connected).toBe(true);
    }
  );

  it('resolves a session bot to its kind, defaulting to Chat', () => {
    expect(kindForBot('bot-cursor', roster)).toBe('coder');
    expect(kindForBot(`bot|${MACRO_CODER_BOT_ID}`, roster)).toBe('coder');
    expect(kindForBot('bot-in-memory', roster)).toBe('agent');
    expect(kindForBot('someone-elses-bot', roster)).toBe('agent');
    expect(kindForBot(undefined, roster)).toBe('agent');
  });
});
