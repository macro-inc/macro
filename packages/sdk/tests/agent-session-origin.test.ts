import { describe, expect, test } from 'bun:test';
import { sessionOrigin } from '../src/entities/agent-sessions/origin';
import type { MacroClient } from '../src/utils/client';

// Handles are lazy, so mapping never touches the network.
const client = {} as MacroClient;

const user = 'macro|user@example.com';
const bot = '01a00000-0000-7000-8000-0000000000b7';
const routine = '01a00000-0000-7000-8000-00000000000c';
const channel = '01a00000-0000-7000-8000-000000000001';

describe('sessionOrigin', () => {
  test('a task an agent assigned traces back to the routine behind it', () => {
    const origin = sessionOrigin(
      client,
      {
        origin: 'task_assigned',
        task: 'task-1',
        by: {
          type: 'agent',
          bot,
          on_behalf_of: user,
          lineage: {
            type: 'session',
            session: '01a00000-0000-7000-8000-00000000000a',
            root: { type: 'routine', routine },
          },
        },
      },
      undefined,
    );

    if (origin.kind !== 'task_assigned' || origin.by.type !== 'agent') {
      throw new Error('expected an agent task assignment');
    }
    expect(origin.task.id).toBe('task-1');
    expect(origin.by.agent.id).toBe(bot);
    if (
      origin.by.lineage.type !== 'session' ||
      origin.by.lineage.root.type !== 'routine'
    ) {
      throw new Error('expected a known lineage');
    }
    expect(origin.by.lineage.root.routine.id).toBe(routine);
  });

  test('a mention has a message handle only in a channel', () => {
    const raw = {
      origin: 'mentioned',
      message_id: '01a00000-0000-7000-8000-000000000003',
      by: { type: 'person', user },
    } as const;

    const inChannel = sessionOrigin(client, raw, channel);
    const elsewhere = sessionOrigin(client, raw, undefined);

    expect(inChannel).toMatchObject({ kind: 'mentioned' });
    expect(inChannel.kind === 'mentioned' && inChannel.message?.id).toBe(
      raw.message_id,
    );
    expect(elsewhere.kind === 'mentioned' && elsewhere.message).toBeUndefined();
  });

  test('a routine reports what fired it', () => {
    const origin = sessionOrigin(
      client,
      {
        origin: 'routine',
        routine,
        firing: {
          type: 'event',
          event_id: '01a00000-0000-7000-8000-00000000000e',
        },
      },
      undefined,
    );

    expect(origin).toMatchObject({ kind: 'routine', firing: 'event' });
  });
});
