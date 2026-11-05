import { assertEquals } from '@std/assert';
import { Brain } from './brain.ts';
import { AsyncQueue } from './channel.ts';
import { gatewayHosts } from './config.ts';
import { MacroHttp } from './macro.ts';
import type { Socket } from './presence.ts';
import type { Outcome, RunEvent, RunHandle, Turn } from './runner.ts';
import { gitCli } from './workspace.ts';

const TEMPLATE = new URL('../template/', import.meta.url).pathname;

Deno.test('a direct message wakes a respond turn that replies, shows typing, and commits the turn', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-run-' });
  const remote = `${root}/remote.git`;
  const workspace = `${root}/workspace`;
  await gitCli(root)(['init', '-q', '--bare', '-b', 'main', remote]);
  await gitCli(root)(['clone', '-q', remote, workspace]);
  const git = gitCli(workspace);
  await git(['config', 'user.email', 'ada@example.com']);
  await git(['config', 'user.name', 'Ada']);
  await new Deno.Command('cp', {
    args: ['-r', `${TEMPLATE}.`, workspace],
    clearEnv: true,
    env: { PATH: Deno.env.get('PATH') ?? '' },
  }).output();
  await git(['add', '-A']);
  await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  await git(['push', '-q', '-u', 'origin', 'main']);

  const stop = new AbortController();
  const requests: { method: string; path: string; body: unknown }[] = [];
  const event = JSON.stringify({
    event_id: 'event-1',
    event_type: 'message.posted',
    metadata: {
      message_id: 'message-1',
      content: 'can you send me the March invoice?',
      created_at: '2026-11-04T10:00:00Z',
      parent: { type: 'channel', id: 'dm-1' },
      root_id: 'message-1',
      sender: 'macro|bo@example.com',
    },
  });

  const http = new MacroHttp(
    gatewayHosts('https://gateway.example'),
    'mak_agent',
    async (url, init) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      requests.push({
        method,
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (path === '/auth/user/me')
        return Response.json({ user_id: 'macro|ada@example.com' });
      if (path === '/dss/channels/dm-1')
        return Response.json({
          channel_id: 'dm-1',
          channel_name: 'Bo Lee',
          channel_type: 'direct_message',
        });
      if (path === '/dss/webhook/events/stream') {
        const signal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${event}\n\n`)
              );
              signal?.addEventListener('abort', () =>
                controller.error(new Error('aborted'))
              );
            },
          })
        );
      }
      if (path === '/dss/messages/channel/dm-1' && method === 'POST')
        return Response.json({ id: 'message-2' });
      if (path === '/dss/messages/channel/dm-1/typing')
        return new Response(null, { status: 204 });
      return new Response(`unexpected ${method} ${path}`, { status: 500 });
    }
  );

  const turns: Turn[] = [];
  const brain: Brain = new Brain({
    config: {
      macroApiKey: 'mak_agent',
      gateway: 'https://gateway.example',
      hosts: gatewayHosts('https://gateway.example'),
      workspace,
      healthPort: 0,
      anthropicBaseUrl: 'https://gateway.example/anthropic',
      anthropicAuthToken: 'gateway-token',
    },
    http,
    tasks: { create: () => Promise.reject(new Error('no hand-off here')) },
    routines: {
      create: () => Promise.reject(new Error('no schedules here')),
      list: async () => [],
      delete: async () => {},
    },
    runner: {
      start(turn): RunHandle {
        turns.push(turn);
        const done = (async (): Promise<Outcome> => {
          await brain.post(
            turn.env.BRAIN_TURN_ID ?? null,
            'dm-1',
            'sent, check your inbox'
          );
          stop.abort();
          return {
            status: 'success',
            result: 'replied',
            costUsd: 0.4,
            sessionId: 'session-1',
          };
        })();
        return {
          events: new AsyncQueue<RunEvent>(),
          inject: () => {},
          abort: () => {},
          done,
        };
      },
    },
    git,
    openSocket: (): Socket => ({
      readyState: 0,
      send: () => {},
      close: () => {},
      onopen: null,
      onclose: null,
      onerror: null,
    }),
    exe: '/usr/local/bin/brain',
    baseEnv: { PATH: '/usr/bin' },
    log: () => {},
  });

  await brain.run(stop.signal);

  assertEquals(turns.length, 1);
  assertEquals(turns[0]?.tier, 'respond');
  assertEquals(turns[0]?.cwd, workspace);
  assertEquals(turns[0]?.maxBudgetUsd, 3);
  assertEquals(
    turns[0]?.prompt.includes('can you send me the March invoice?'),
    true
  );
  assertEquals(turns[0]?.env.MACRO_API_KEY, undefined);

  const talk = requests.filter((request) =>
    request.path.startsWith('/dss/messages/channel/dm-1')
  );
  assertEquals(talk[0]?.body, { active: true, thread_id: null });
  assertEquals(
    (talk[1]?.body as { content: string; thread_id: null }).content,
    'sent, check your inbox'
  );
  assertEquals(talk.at(-1)?.body, { active: false, thread_id: null });

  const log = await gitCli(root)([
    '--git-dir',
    remote,
    'log',
    '-1',
    '--format=%s',
    'main',
  ]);
  assertEquals(
    /^turn respond-\d{8}T\d{6}-dm-1: respond in Bo Lee: success$/.test(
      log.stdout.trim()
    ),
    true
  );
  const self = JSON.parse(
    await Deno.readTextFile(`${workspace}/memory/self.json`)
  );
  assertEquals(self.lastSaid['dm-1'].text, 'sent, check your inbox');
});
