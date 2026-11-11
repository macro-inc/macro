import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';
import { tool, type Wiring, z } from './mod.ts';
import type { Turn } from './runner.ts';
import { runCommand } from './subprocess.ts';

async function boot(
  wiring: Wiring,
  before: {
    event_id: string;
    event_type: string;
    metadata: unknown;
  }[] = []
): Promise<Turn[]> {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-hooks-')
  );
  const turns: Turn[] = [];
  try {
    const copied = await runCommand('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.deepEqual(copied.code, 0);
    await dryRun(
      (deps) =>
        new Brain(
          {
            ...deps,
            runner: {
              start(turn) {
                turns.push(turn);
                return deps.runner.start(turn);
              },
            },
          },
          wiring
        ),
      root,
      before,
      false
    );
    return turns;
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
}
test('onEvent observes typed subscriptions before the default message handler', async () => {
  const observed: string[] = [];
  await boot(
    {
      subscriptions: ['document.updated'],
      onEvent: async (event) => {
        observed.push(event.type === 'other' ? event.eventType : event.type);
      },
    },
    [
      {
        event_id: 'updated',
        event_type: 'document.updated',
        metadata: { document_id: 'document' },
      },
    ]
  );
  assert.deepEqual(observed, ['document.updated', 'message.posted']);
});
test('custom relevance receives message context and controls lane admission', async () => {
  const judged: string[] = [];
  const turns = await boot({
    relevance: async (item) => {
      judged.push(item.message.text);
      return { relevant: true, reason: 'decided', probabilities: {} };
    },
  });
  assert.deepEqual(judged, ['brain check']);
  assert.deepEqual(turns.length, 1);
});
test('route sends a conversation batch to a custom tier with its own cap', async () => {
  const turns = await boot({
    tiers: { review: { concurrency: 1, perRunUsd: 0.4, speaking: true } },
    route(item) {
      assert.deepEqual(item.kind, 'respond');
      return 'review';
    },
  });
  assert.deepEqual(turns[0]?.tier, 'review');
  assert.deepEqual(turns[0]?.maxBudgetUsd, 0.4);
});
test('beforeTurn edits prompt model tier budget and the per-turn tool set before admission', async () => {
  const echo = tool(
    'echo',
    'Echo a value',
    { value: z.string() },
    async ({ value }) => ({ content: [{ type: 'text', text: value }] })
  );
  const turns = await boot({
    tiers: { review: { concurrency: 1, perRunUsd: 1 } },
    beforeTurn(turn) {
      return {
        ...turn,
        prompt: 'rewritten',
        model: 'custom-model',
        tier: 'review',
        maxBudgetUsd: 0.2,
        tools: [echo],
      };
    },
  });
  assert.deepEqual(turns[0]?.prompt, 'rewritten');
  assert.deepEqual(turns[0]?.model, 'custom-model');
  assert.deepEqual(turns[0]?.tier, 'review');
  assert.deepEqual(turns[0]?.maxBudgetUsd, 0.2);
  assert.deepEqual(turns[0]?.tools?.[0], echo);
});
test('afterTurn receives the admitted turn and recorded outcome before draining finishes', async () => {
  const completed: string[] = [];
  await boot({
    async afterTurn(turn, outcome) {
      completed.push(`${turn.tier}:${turn.maxBudgetUsd}:${outcome.status}`);
    },
  });
  assert.deepEqual(completed, ['respond:3:success']);
});
test('tools declared by the composition reach every turn by default', async () => {
  const status = tool('status', 'Status', {}, async () => ({
    content: [{ type: 'text', text: 'ready' }],
  }));
  const turns = await boot({ tools: [status] });
  assert.deepEqual(turns[0]?.tools?.[0], status);
});
test('onSchedule handles a declared routine in code without starting an extra Claude turn', async () => {
  const handled: string[] = [];
  const turns = await boot(
    {
      schedules: [
        {
          note: 'sweep',
          trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
        },
      ],
      onSchedule: async (wake, brain) => {
        handled.push(wake.schedule?.note ?? 'missing');
        await brain.remember('sweeps', wake.sessionName);
      },
    },
    [
      {
        event_id: 'wake',
        event_type: 'agent_session.opened',
        metadata: {
          identity: {
            session_id: 'session',
            session_name: 'wake: sweep',
            owner_id: 'brain-check',
            source: 'routine',
          },
        },
      },
    ]
  );
  assert.deepEqual(handled, ['sweep']);
  assert.deepEqual(turns.length, 1);
  assert.deepEqual(turns[0]?.tier, 'respond');
});
test('outbound middleware wraps both posts and replies and records transformed text', async () => {
  const sent: string[] = [];
  await boot({
    outbound: [
      async (message, next) => {
        sent.push(`${message.root ?? 'top'}:${message.text}`);
        return next({ ...message, text: `edited ${message.text}` });
      },
    ],
    onEvent: async (_event, brain) => {
      await brain.post(null, 'check', 'post');
      await brain.reply(null, 'check', 'root', 'reply');
      const state = JSON.parse(
        await nodeFs.readFile(brain.workspace.path('memory/self.json'), 'utf8')
      );
      assert.deepEqual(state.lastSaid['check.root'].text, 'edited reply');
    },
  });
  assert.deepEqual(sent, ['top:post', 'root:reply']);
});
test('quiet-hours middleware can suppress delivery with a typed reason', async () => {
  await boot({
    outbound: [async () => ({ suppressed: true, reason: 'quiet hours' })],
    onEvent: async (_event, brain) => {
      assert.deepEqual(await brain.post(null, 'check', 'quiet'), {
        suppressed: true,
        reason: 'quiet hours',
      });
    },
  });
});
test('onCall receives lifecycle data and can use the default brain capabilities', async () => {
  const calls: string[] = [];
  await boot({
    onCall: async (call, brain) => {
      calls.push(call.id);
      await brain.remember('calls', call.phase);
    },
    onEvent: async (_event, brain) => {
      await brain.onCall({
        id: 'call',
        phase: 'ended',
        metadata: { durationSeconds: 20 },
      });
    },
  });
  assert.deepEqual(calls, ['call']);
});
