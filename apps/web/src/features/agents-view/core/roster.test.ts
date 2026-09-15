import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { describe, expect, it } from 'vitest';
import {
  buildAgentRoster,
  kindForBot,
  MACRO_PERSONA_ID,
  type PersistedAgentLike,
  type RosterInput,
  rosterForMode,
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
      [MACRO_CODER_BOT_ID, 'coder'],
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
    const saved = roster.slice(3);
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

describe('rosterForMode and kindForBot', () => {
  const roster = buildAgentRoster({
    ...EMPTY,
    agents: [
      persisted({ harness: 'in-memory' }),
      persisted({ harness: 'cursor' }),
    ],
  });

  it('splits the roster by mode', () => {
    expect(rosterForMode(roster, 'chat').map((a) => a.id)).toEqual([
      MACRO_PERSONA_ID,
      'bot-in-memory',
    ]);
    expect(rosterForMode(roster, 'code').map((a) => a.id)).toEqual([
      MACRO_CODER_BOT_ID,
      CURSOR_BOT_ID,
      'bot-cursor',
    ]);
  });

  it('resolves a session bot to its kind, defaulting to Chat', () => {
    expect(kindForBot('bot-cursor', roster)).toBe('coder');
    expect(kindForBot(`bot|${MACRO_CODER_BOT_ID}`, roster)).toBe('coder');
    expect(kindForBot('bot-in-memory', roster)).toBe('agent');
    expect(kindForBot('someone-elses-bot', roster)).toBe('agent');
    expect(kindForBot(undefined, roster)).toBe('agent');
  });
});
