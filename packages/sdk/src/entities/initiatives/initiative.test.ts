import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Initiative } from './initiative';

describe('initiative activity', () => {
  test('follows the cursor with the same window until the last page', async () => {
    const requests: unknown[] = [];
    const pages = [
      {
        records: [
          {
            id: '0192d1a0-0000-7000-8000-0000000000a2',
            actorId: 'bot|0192d1a0-0000-7000-8000-0000000000b1',
            subjectId: 'macro|ada@example.com',
            action: 'task_added',
            actionPayload: { task_id: '0192d1a0-0000-7000-8000-0000000000c1' },
            occurredAt: '2026-11-04T10:00:00Z',
          },
        ],
        nextCursor: {
          occurredAt: '2026-11-04T10:00:00Z',
          id: '0192d1a0-0000-7000-8000-0000000000a2',
        },
      },
      {
        records: [
          {
            id: '0192d1a0-0000-7000-8000-0000000000a1',
            actorId: 'macro|ada@example.com',
            subjectId: 'macro|ada@example.com',
            action: 'created',
            actionPayload: null,
            occurredAt: '2026-11-03T10:00:00Z',
          },
        ],
        nextCursor: null,
      },
    ];
    const client = {
      storage: {
        getInitiativeActivity: async (request: unknown) => {
          requests.push(request);
          return { data: pages[requests.length - 1] };
        },
      },
    } as unknown as MacroClient;

    const entries = [];
    for await (const entry of Initiative.byId(
      client,
      '0192d1a0-0000-7000-8000-0000000000d1',
    ).activity({ after: new Date('2026-11-01T00:00:00Z') })) {
      entries.push(entry);
    }

    expect(requests).toEqual([
      {
        path: { initiative_id: '0192d1a0-0000-7000-8000-0000000000d1' },
        query: {
          after: '2026-11-01T00:00:00.000Z',
          before: undefined,
          cursorOccurredAt: undefined,
          cursorId: undefined,
        },
      },
      {
        path: { initiative_id: '0192d1a0-0000-7000-8000-0000000000d1' },
        query: {
          after: '2026-11-01T00:00:00.000Z',
          before: undefined,
          cursorOccurredAt: '2026-11-04T10:00:00Z',
          cursorId: '0192d1a0-0000-7000-8000-0000000000a2',
        },
      },
    ]);
    expect(
      entries.map((entry) => [
        entry.action,
        entry.actor.id,
        entry.subject.id,
        entry.payload,
      ]),
    ).toEqual([
      [
        'task_added',
        'bot|0192d1a0-0000-7000-8000-0000000000b1',
        'macro|ada@example.com',
        { task_id: '0192d1a0-0000-7000-8000-0000000000c1' },
      ],
      ['created', 'macro|ada@example.com', 'macro|ada@example.com', undefined],
    ]);
  });
});
