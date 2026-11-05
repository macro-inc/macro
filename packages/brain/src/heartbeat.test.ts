import { assertEquals } from '@std/assert';
import { snapshotText, wakeReason } from './heartbeat.ts';

Deno.test('the heartbeat sleeps through an unchanged snapshot until the sweep is due', () => {
  const unchanged = {
    hash: 'abc',
    lastHash: 'abc',
    lastRunSeconds: 1_000_000,
    sweepHours: 24,
  };

  assertEquals(
    wakeReason({ ...unchanged, nowSeconds: 1_000_000 + 3600 }),
    null
  );
  assertEquals(
    wakeReason({ ...unchanged, nowSeconds: 1_000_000 + 25 * 3600 }),
    'sweep due'
  );
  assertEquals(
    wakeReason({
      ...unchanged,
      hash: 'def',
      nowSeconds: 1_000_000 + 25 * 3600,
    }),
    'snapshot changed; sweep due'
  );
});

Deno.test('the snapshot lists focus, commitments, schedules and work', () => {
  const text = snapshotText({
    self: {
      focus: 'March books',
      commitments: [
        {
          what: 'send Bo the invoice',
          to: 'macro|bo@example.com',
          conversation: null,
          since: '2026-11-04',
        },
      ],
      lastSaid: {},
    },
    schedules: [],
    work: [
      {
        conversation: 'channel-1',
        taskId: 'task-1',
        label: 'fix invoice',
        startedAt: '2026-11-04T10:00:00Z',
      },
    ],
  });

  assertEquals(
    text,
    [
      'Focus: March books',
      'Commitments:',
      '- send Bo the invoice (to macro|bo@example.com, since 2026-11-04)',
      'Schedules:',
      '(none)',
      'Work in flight:',
      '- fix invoice (task task-1, since 2026-11-04T10:00:00Z)',
    ].join('\n')
  );
});
