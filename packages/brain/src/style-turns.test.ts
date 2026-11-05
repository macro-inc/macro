import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { Brain } from './brain.ts';
import { AsyncQueue } from './channel.ts';
import { gatewayHosts } from './config.ts';
import { MacroHttp } from './macro.ts';
import type { RunEvent, Turn } from './runner.ts';
import { readStyle } from './style.ts';
import { runCommand } from './subprocess.ts';
import { gitCli } from './workspace.ts';

const TEMPLATE = new URL('../template/', import.meta.url).pathname;
test('respond, heartbeat and work turns receive every style guide, including edits made between turns', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-style-turns-')
  );
  const workspace = `${root}/workspace`;
  const git = gitCli(workspace);
  const stop = new AbortController();
  let running: Promise<void> | undefined;
  try {
    await gitCli(root)([
      'init',
      '-q',
      '--bare',
      '-b',
      'main',
      `${root}/remote.git`,
    ]);
    await gitCli(root)(['clone', '-q', `${root}/remote.git`, workspace]);
    await git(['config', 'user.email', 'agent@example.com']);
    await git(['config', 'user.name', 'Example']);
    const copied = await runCommand('cp', {
      args: ['-r', `${TEMPLATE}.`, workspace],
    });
    assert.deepEqual(copied.code, 0);
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
    await git(['push', '-q', '-u', 'origin', 'main']);
    const responded = Promise.withResolvers<Turn>();
    const turns: Turn[] = [];
    const http = new MacroHttp(
      gatewayHosts('https://gateway.example'),
      'test-key',
      async (url, init) => {
        const path = new URL(url).pathname;
        if (path === '/auth/user/me')
          return Response.json({ user_id: 'macro|agent@example.com' });
        if (path === '/dss/channels/dm-1')
          return Response.json({
            channel_id: 'dm-1',
            channel_type: 'direct_message',
          });
        if (path === '/dss/webhook/events/stream') {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const event = {
                  event_id: 'event-style',
                  event_type: 'message.posted',
                  metadata: {
                    message_id: 'message-style',
                    content: 'Is the draft ready?',
                    created_at: '2026-11-05T10:00:00Z',
                    parent: { type: 'channel', id: 'dm-1' },
                    root_id: 'message-style',
                    sender: 'macro|colleague@example.com',
                  },
                };
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
                );
                init?.signal?.addEventListener('abort', () =>
                  controller.error(new Error('aborted'))
                );
              },
            })
          );
        }
        if (path === '/dss/messages/channel/dm-1/typing')
          return new Response(null, { status: 204 });
        if (path === '/dss/messages/channel/dm-1')
          return Response.json({ id: 'report-style' });
        throw new Error(`unexpected test request: ${path}`);
      }
    );
    const brain = new Brain({
      config: {
        gateway: 'https://gateway.example',
        hosts: gatewayHosts('https://gateway.example'),
        workspace,
        healthPort: 0,
        anthropicBaseUrl: 'https://gateway.example/anthropic',
      },
      http,
      tasks: {
        create: async () => ({
          id: 'task-style',
          url: 'https://example.com/task',
        }),
      },
      routines: {
        create: async () => {
          throw new Error('no schedules');
        },
        list: async () => [],
        delete: async () => {},
      },
      runner: {
        start(turn) {
          turns.push(turn);
          if (turn.tier === 'respond') responded.resolve(turn);
          return {
            events: new AsyncQueue<RunEvent>(),
            inject: () => {},
            abort: () => {},
            done: Promise.resolve({
              status: 'success' as const,
              result: 'Done.',
              costUsd: 0,
              sessionId: turn.id,
            }),
          };
        },
      },
      git,
      presence: () => () => {},
      exe: '/usr/local/bin/brain',
      baseEnv: {},
      log: () => {},
    });
    const original = await readStyle(`${workspace}/prompts/style`);
    running = brain.run(stop.signal);
    const respond = await responded.promise;
    assert.ok(respond.system.includes(original));
    await nodeFs.mkdir(`${workspace}/prompts/style/local`);
    await nodeFs.writeFile(
      `${workspace}/prompts/style/local/team.md`,
      'A newly added team guide.'
    );
    await nodeFs.writeFile(
      `${workspace}/prompts/style/brevity.md`,
      'A revised brevity guide.'
    );
    const revised = await readStyle(`${workspace}/prompts/style`);
    await brain.heartbeat('check promised draft');
    await brain.handoff(
      { channel: 'dm-1', root: null },
      'check draft',
      'Check the draft.'
    );
    stop.abort();
    await running;
    assert.deepEqual(
      turns.map((turn) => turn.tier),
      ['respond', 'heartbeat', 'work']
    );
    for (const turn of turns.slice(1)) {
      assert.ok(turn.system.includes(revised));
      assert.ok(turn.system.includes('A newly added team guide.'));
      assert.ok(turn.system.includes('A revised brevity guide.'));
    }
    for (const turn of turns) {
      assert.deepEqual(turn.system.includes('# Style library'), false);
      assert.ok(turn.prompt.includes('prompts/style/'));
    }
  } finally {
    stop.abort();
    await running;
    await nodeFs.rm(root, { recursive: true });
  }
});
