// A real boot through the event stream and a fake turn. No network or model calls.
import type { BrainDeps } from './brain.ts';
import { gatewayHosts } from './config.ts';
import { MacroHttp } from './macro.ts';
import type { Composition } from './mod.ts';
import { gitCli } from './workspace.ts';

export async function dryRun(
  compose: Composition,
  workspace: string,
  before: { event_id: string; event_type: string; metadata: unknown }[] = []
): Promise<void> {
  const stop = new AbortController();
  let received = false;
  let turns = 0;
  const routines: { id: string; name: string }[] = [];
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
                    event_id: 'brain-check',
                    event_type: 'message.posted',
                    metadata: {
                      message_id: 'check',
                      content: 'brain check',
                      created_at: new Date().toISOString(),
                      parent: { type: 'channel', id: 'check' },
                      root_id: 'check',
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
      if (path === '/dss/messages/channel/check')
        return Response.json({ id: 'check-post' });
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
      start() {
        turns++;
        return {
          events: (async function* () {})(),
          inject() {},
          abort() {},
          done: Promise.resolve({
            status: 'success' as const,
            result: 'checked',
            costUsd: 0,
            sessionId: null,
          }).then((outcome) => {
            stop.abort();
            return outcome;
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
    log: (line) => console.error(JSON.stringify(line)),
  };
  const runtime = await compose(deps);
  await runtime.run(stop.signal);
  if (!received || turns === 0)
    throw new Error(
      'dry boot must consume the fake message and complete a turn'
    );
}
