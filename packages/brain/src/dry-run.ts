// A real boot through the event stream and a fake turn. No network or model calls.
import type { BrainDeps } from './brain.ts';
import { gatewayHosts } from './config.ts';
import { fixtures } from './learning.ts';
import { MacroHttp } from './macro.ts';
import type { BrainRuntime, Composition } from './mod.ts';
import type { Outcome, Turn } from './runner.ts';
import { gitCli } from './workspace.ts';
export async function dryRun(
  compose: Composition,
  workspace: string,
  before: {
    event_id: string;
    event_type: string;
    metadata: unknown;
  }[] = [],
  verifyDelivery = true,
  regressionRoot = workspace
): Promise<void> {
  const fakeId = `brain-check-${crypto.randomUUID()}`;
  const stop = new AbortController();
  let received = false;
  let turns = 0;
  let posts = 0;
  let fault: Error | undefined;
  const failed = Promise.withResolvers<never>();
  let runtime: BrainRuntime;
  const admitted = Promise.withResolvers<Turn>();
  const completed = Promise.withResolvers<Outcome>();
  const routines: {
    id: string;
    name: string;
  }[] = [];
  const http = new MacroHttp(
    gatewayHosts('https://gateway.invalid'),
    'fake',
    async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/auth/user/me')
        return Response.json({ user_id: 'brain-check' });
      if (path === '/dss/channels/check')
        return Response.json({
          channel_id: 'check',
          channel_name: 'check',
          channel_type: 'direct_message',
        });
      if (path === '/dss/webhook/events/stream') {
        received = true;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const event of before)
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
                );
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({
                    event_id: fakeId,
                    event_type: 'message.posted',
                    metadata: {
                      message_id: fakeId,
                      content: 'brain check',
                      created_at: new Date().toISOString(),
                      parent: { type: 'channel', id: 'check' },
                      root_id: fakeId,
                      sender: 'check-sender',
                    },
                  })}\n\n`
                )
              );
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('check complete')),
                { once: true }
              );
            },
          })
        );
      }
      if (path === '/dss/messages/channel/check') {
        posts++;
        return Response.json({ id: 'check-post' });
      }
      if (path.endsWith('/typing')) return new Response(null, { status: 204 });
      throw new Error(`dry boot made an unexpected request: ${path}`);
    }
  );
  const deps: BrainDeps = {
    config: {
      workspace,
      healthPort: 0,
      gateway: 'https://gateway.invalid',
      hosts: gatewayHosts('https://gateway.invalid'),
      anthropicBaseUrl: 'https://gateway.invalid/anthropic',
    },
    http,
    runner: {
      start(turn) {
        turns++;
        if (turn.lane === 'check') admitted.resolve(turn);
        return {
          events: (async function* () {})(),
          inject() {},
          abort() {},
          done:
            turn.lane === 'check'
              ? completed.promise
              : Promise.resolve({
                  status: 'success' as const,
                  result: 'IGNORE',
                  costUsd: 0,
                  sessionId: null,
                }),
        };
      },
    },
    tasks: {
      create() {
        throw new Error('no tasks during check');
      },
    },
    routines: {
      list: async () => routines,
      async create(options) {
        const routine = { id: `check-${routines.length}`, name: options.name };
        routines.push(routine);
        return routine;
      },
      delete: async () => {},
    },
    git: async (args) => {
      // The fixture may read git state, but must never commit or push user work.
      if (['rev-parse', 'status', 'diff'].includes(args[0] ?? ''))
        return gitCli(workspace)(args);
      return { code: 0, stdout: '0', stderr: '' };
    },
    presence: () => () => {},
    exe: 'brain',
    baseEnv: {},
    log: (line) => {
      console.error(JSON.stringify(line));
      if (
        verifyDelivery &&
        ('batch_failed' in line ||
          'handle_failed' in line ||
          'heartbeat_failed' in line)
      ) {
        fault ??= new Error('fake boot handler failed');
        failed.reject(fault);
      }
    },
  };
  runtime = await compose(deps);
  if (
    typeof runtime.prepare !== 'function' ||
    typeof runtime.health !== 'function'
  )
    throw new Error('composition must implement prepare, run, health and post');
  for (const fixture of [
    ...(await fixtures(workspace)),
    ...(await fixtures(regressionRoot)),
  ]) {
    if (!(await runtime.checkFixture(fixture)))
      throw new Error(
        `filter drops must-wake fixture ${fixture.candidate.messageId}`
      );
  }
  await runtime.prepare(stop.signal);
  const running = runtime.run(stop.signal);
  try {
    const turn = await Promise.race([
      admitted.promise,
      failed.promise,
      running.then(() => {
        throw new Error('boot ended before answering the fake DM');
      }),
    ]);
    const health = await runtime.health();
    if (
      health.status !== 'ok' ||
      !health.connected ||
      typeof health.startedAt !== 'string' ||
      !Array.isArray(health.turns) ||
      !Array.isArray(health.work) ||
      !Array.isArray(health.problems) ||
      !Number.isFinite(health.spentTodayUsd) ||
      !(
        health.lastEventAt === null || typeof health.lastEventAt === 'string'
      ) ||
      !(health.lastTurnAt === null || typeof health.lastTurnAt === 'string')
    )
      throw new Error('composition does not satisfy the health contract');
    if (verifyDelivery)
      await runtime.post(turn.id, 'check', 'fake DM response');
    stop.abort();
    // An aborted intake must leave the admitted turn alive until its outcome arrives.
    if (!(await runtime.health()).turns.some((active) => active.id === turn.id))
      throw new Error(
        'composition aborted its in-flight turn instead of draining'
      );
    completed.resolve({
      status: 'success',
      result: 'checked',
      costUsd: 0,
      sessionId: null,
    });
    await running;
    if (fault) throw fault;
    if (
      !received ||
      turns === 0 ||
      (verifyDelivery && posts === 0) ||
      (await runtime.health()).turns.length !== 0
    )
      throw new Error('dry boot must consume, answer, and drain the fake DM');
  } finally {
    stop.abort();
    completed.resolve({
      status: 'success',
      result: 'checked',
      costUsd: 0,
      sessionId: null,
    });
    await running;
  }
}
