import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/features/agent-updates/views/AgentUpdatesStack', () => ({
  AgentUpdatesStack: () => null,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));

import { sessionsOf } from './ListAgentUpdates';

describe('sessionsOf', () => {
  it('opens each waiting session once and keeps stalled sessions static', () => {
    const sessions = sessionsOf(
      {
        truncated: false,
        items: [
          {
            sessionId: 'a',
            sessionName: 'Signing',
            harness: 'opencode',
            kind: 'permission',
            summary: 'Signing wants to run codesign',
            since: '2026-10-30T20:00:00Z',
            options: ['Allow'],
          },
          {
            sessionId: 'a',
            sessionName: 'Signing',
            harness: 'opencode',
            kind: 'elicitation',
            summary: 'Signing asks which certificate',
            since: '2026-10-30T20:01:00Z',
            options: [],
          },
          {
            sessionId: 'b',
            sessionName: 'PDF zoom',
            harness: 'cursor',
            kind: 'stalled',
            summary: 'No activity for 23 minutes',
            since: '2026-10-30T19:40:00Z',
            options: [],
          },
        ],
      },
      'me'
    );
    expect(sessions.map((session) => [session.id, session.turnState])).toEqual([
      ['a', 'blocked'],
      ['b', 'running'],
    ]);
    expect(sessions.every((session) => session.ownerId === 'me')).toBe(true);
  });

  it('shows nothing before the user is known', () => {
    expect(sessionsOf({ truncated: false, items: [] }, undefined)).toEqual([]);
  });
});
