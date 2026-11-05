import { assertEquals } from '@std/assert';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';
import { tool, type Wiring, z } from './mod.ts';
import type { Turn } from './runner.ts';

async function boot(
  wiring: Wiring,
  before: { event_id: string; event_type: string; metadata: unknown }[] = []
): Promise<Turn[]> {
  const root = await Deno.makeTempDir({ prefix: 'brain-hooks-' });
  const turns: Turn[] = [];
  try {
    const copied = await new Deno.Command('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).output();
    assertEquals(copied.code, 0);
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
      before
    );
    return turns;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('onEvent observes typed subscriptions before the default message handler', async () => {
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
  assertEquals(observed, ['document.updated', 'message.posted']);
});

Deno.test('custom relevance receives message context and controls lane admission', async () => {
  const judged: string[] = [];
  const turns = await boot({
    relevance: async (item) => {
      judged.push(item.message.text);
      return { relevant: true, reason: 'decided', probabilities: {} };
    },
  });
  assertEquals(judged, ['brain check']);
  assertEquals(turns.length, 1);
});

Deno.test('route sends a conversation batch to a custom tier with its own cap', async () => {
  const turns = await boot({
    tiers: { review: { concurrency: 1, perRunUsd: 0.4, speaking: true } },
    route(item) {
      assertEquals(item.kind, 'respond');
      return 'review';
    },
  });
  assertEquals(turns[0]?.tier, 'review');
  assertEquals(turns[0]?.maxBudgetUsd, 0.4);
});

Deno.test('beforeTurn edits prompt model tier budget and the per-turn tool set before admission', async () => {
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
  assertEquals(turns[0]?.prompt, 'rewritten');
  assertEquals(turns[0]?.model, 'custom-model');
  assertEquals(turns[0]?.tier, 'review');
  assertEquals(turns[0]?.maxBudgetUsd, 0.2);
  assertEquals(turns[0]?.tools?.[0], echo);
});

Deno.test('afterTurn receives the admitted turn and recorded outcome before draining finishes', async () => {
  const completed: string[] = [];
  await boot({
    async afterTurn(turn, outcome) {
      completed.push(`${turn.tier}:${turn.maxBudgetUsd}:${outcome.status}`);
    },
  });
  assertEquals(completed, ['respond:3:success']);
});

Deno.test('tools declared by the composition reach every turn by default', async () => {
  const status = tool('status', 'Status', {}, async () => ({
    content: [{ type: 'text', text: 'ready' }],
  }));
  const turns = await boot({ tools: [status] });
  assertEquals(turns[0]?.tools?.[0], status);
});

Deno.test('onSchedule handles a declared routine in code without starting an extra Claude turn', async () => {
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
  assertEquals(handled, ['sweep']);
  assertEquals(turns.length, 1);
  assertEquals(turns[0]?.tier, 'respond');
});

Deno.test('outbound middleware wraps both posts and replies and records transformed text', async () => {
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
        await Deno.readTextFile(brain.workspace.path('memory/self.json'))
      );
      assertEquals(state.lastSaid['check.root'].text, 'edited reply');
    },
  });
  assertEquals(sent, ['top:post', 'root:reply']);
});

Deno.test('quiet-hours middleware can suppress delivery with a typed reason', async () => {
  await boot({
    outbound: [async () => ({ suppressed: true, reason: 'quiet hours' })],
    onEvent: async (_event, brain) => {
      assertEquals(await brain.post(null, 'check', 'quiet'), {
        suppressed: true,
        reason: 'quiet hours',
      });
    },
  });
});

Deno.test('onCall receives lifecycle data and can use the default brain capabilities', async () => {
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
  assertEquals(calls, ['call']);
});
