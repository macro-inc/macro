import { expect, test } from 'bun:test';
import { startJoin } from '../context/processes.ts';

test("a call's process starts under the agent's sandbox, so its brain can't read the enrollment's secrets", async () => {
  const started: (readonly string[])[] = [];
  const start = startJoin({
    shell: {
      start: (argv) => {
        started.push(argv);
        return { pid: 1, exited: Promise.resolve(0), kill: () => {} };
      },
    },
    disk: { makeDirectory: async () => {} },
    config: { root: '/agent' },
    paths: {
      call: (id) => `/state/calls/${id}`,
      joinLog: (id) => `/state/calls/${id}/join.log`,
      joinErrors: (id) => `/state/calls/${id}/join.err`,
    },
    join: (...parts) => parts.join('/'),
    relayed: async () => ({}),
    sandbox: ['bwrap', '--dev-bind', '/', '/', '--tmpfs', '/run/credentials', '--'],
  });
  await start({ kind: 'channel', id: 'channel-1', callId: 'call-1' });
  const [argv = []] = started;
  expect(argv.slice(0, 7)).toEqual([
    'bwrap',
    '--dev-bind',
    '/',
    '/',
    '--tmpfs',
    '/run/credentials',
    '--',
  ]);
  expect(argv).toContain('/agent/bin/assistant');
  expect(argv).toContain('joinCall');
});
