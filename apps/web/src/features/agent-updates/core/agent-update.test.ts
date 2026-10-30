import type { PendingInteraction } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  blockedSessions,
  eligibleSessions,
  selectAgentUpdates,
  type UpdateSession,
} from './agent-update';

const now = new Date('2026-10-30T12:00:00Z').getTime();
const mine: UpdateSession = {
  id: 'mine',
  name: 'Fix build',
  ownerId: 'me',
  botId: 'bot',
  harness: 'cursor',
  turnState: 'blocked',
  updatedAt: new Date(now - 3 * 60_000).toISOString(),
};

describe('agent updates selection', () => {
  it('keeps only owned, live coding sessions and acquires only blocked ones', () => {
    const eligible = eligibleSessions(
      [
        mine,
        { ...mine, id: 'other', ownerId: 'someone' },
        { ...mine, id: 'archived', isArchived: true },
        { ...mine, id: 'chat', harness: 'in-memory' },
        { ...mine, id: 'running', turnState: 'running' },
      ],
      'me'
    );
    expect(eligible.map((session) => session.id)).toEqual(['mine', 'running']);
    expect(blockedSessions(eligible).map((session) => session.id)).toEqual([
      'mine',
    ]);
  });

  it('makes one card per pending request and sorts newer sessions first', () => {
    const pending: PendingInteraction[] = [
      {
        kind: 'permission',
        requestId: 1,
        turn: 2,
        toolCall: 'tool',
        options: [{ id: 'yes', name: 'Allow', kind: 'allow_once' }],
      },
      {
        kind: 'elicitation',
        requestId: 2,
        turn: 2,
        toolCall: null,
        message: 'Which branch?',
        request: { kind: 'unrecognized', mode: 'test', raw: null },
      },
      {
        kind: 'tool_approval',
        approvalId: 'approval',
        turn: 2,
        serverSlug: 'linear',
        serverName: 'Linear',
        toolName: 'search',
        requestedBy: null,
      },
    ];
    const updates = selectAgentUpdates(
      [
        mine,
        {
          ...mine,
          id: 'newer',
          updatedAt: new Date(now - 60_000).toISOString(),
        },
      ],
      new Map([
        ['mine', pending],
        ['newer', pending.slice(0, 1)],
      ]),
      new Map(),
      now
    );
    expect(updates).toHaveLength(4);
    expect(updates[0]?.sessionId).toBe('newer');
    expect(updates.map((update) => update.summary)).toContain('Which branch?');
    expect(updates.map((update) => update.summary)).toContain(
      'Fix build wants to use search from Linear'
    );
  });

  it('shows a running session only after twenty minutes of inactivity', () => {
    const updates = selectAgentUpdates(
      [
        {
          ...mine,
          id: 'fresh',
          turnState: 'running',
          updatedAt: new Date(now - 20 * 60_000).toISOString(),
        },
        {
          ...mine,
          id: 'stalled',
          turnState: 'running',
          updatedAt: new Date(now - 23 * 60_000).toISOString(),
        },
      ],
      new Map(),
      new Map(),
      now
    );
    expect(updates.map((update) => update.sessionId)).toEqual(['stalled']);
    expect(updates[0]?.summary).toBe('No activity for 23 minutes');
  });

  it('keeps requests with a reused request id distinct across turns', () => {
    const updates = selectAgentUpdates(
      [mine],
      new Map([
        [
          'mine',
          [
            {
              kind: 'permission',
              requestId: 1,
              turn: 1,
              toolCall: 'first',
              options: [],
            },
            {
              kind: 'permission',
              requestId: 1,
              turn: 2,
              toolCall: 'second',
              options: [],
            },
          ],
        ],
      ]),
      new Map(),
      now
    );
    expect(new Set(updates.map((update) => update.id)).size).toBe(2);
  });
});
