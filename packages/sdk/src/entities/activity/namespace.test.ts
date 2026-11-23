import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { User } from '../users/user';
import { ActivityNamespace } from './namespace';

describe('activity', () => {
  test('mine sends the range as timestamps and returns handles for acted-on items', async () => {
    const queries: unknown[] = [];
    const client = {
      cognition: {
        readMyActivity: async ({ query }: { query: unknown }) => {
          queries.push(query);
          return {
            data: {
              activities: [
                {
                  actorId: 'macro|ada@example.com',
                  entityType: 'document',
                  entityId: '0192d1a0-0000-7000-8000-000000000001',
                  action: { type: 'edited' },
                  occurredAt: '2026-11-04T10:00:00Z',
                },
                {
                  actorId: 'macro|ada@example.com',
                  entityType: 'channel_message',
                  entityId: '0192d1a0-0000-7000-8000-000000000002',
                  action: { type: 'created' },
                  occurredAt: '2026-11-04T09:00:00Z',
                },
              ],
              truncated: true,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const range = await new ActivityNamespace(client).mine({
      from: new Date('2026-11-01T00:00:00Z'),
      to: '2026-11-05T00:00:00Z',
    });

    expect(queries).toEqual([
      { from: '2026-11-01T00:00:00.000Z', to: '2026-11-05T00:00:00Z' },
    ]);
    expect(range.truncated).toBe(true);
    const [edited, message] = range.activities;
    expect(edited.actor).toBeInstanceOf(User);
    expect(edited.actor.id).toBe('macro|ada@example.com');
    expect(edited.entity?.type).toBe('document');
    expect(edited.entity?.entity).toBeInstanceOf(Document);
    expect(edited.entity?.entity.id).toBe(
      '0192d1a0-0000-7000-8000-000000000001',
    );
    expect(edited.action).toEqual({ type: 'edited' });
    expect(message.entityType).toBe('channel_message');
    expect(message.entity).toBeUndefined();
  });
});
