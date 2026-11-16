import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { joinEnvironment, startJoin } from '../context/processes.ts';

/** This package: a join runs one of its own programs. */
const root = join(import.meta.dir, '..', '..', '..', '..');

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
    config: { root },
    paths: {
      call: (id) => `/state/calls/${id}`,
      joinLog: (id) => `/state/calls/${id}/join.log`,
      joinErrors: (id) => `/state/calls/${id}/join.err`,
    },
    join,
    relayed: async () => ({}),
    sandbox: [
      'bwrap',
      '--dev-bind',
      '/',
      '/',
      '--tmpfs',
      '/run/credentials',
      '--',
    ],
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
  const program = argv[argv.indexOf('joinCall') - 1] ?? '';
  expect(program).toBe(join(root, 'bin', 'agent'));
  expect(existsSync(program)).toBe(true);
});

test("a call's process keeps the native-library path its audio needs, and nothing else of the agent's", () => {
  expect(
    joinEnvironment(
      {
        LD_LIBRARY_PATH: '/nix/store/gcc-lib/lib',
        MACRO_API_KEY: 'mak_secret',
        PATH: '/bin',
      },
      { MUPPET_RELAY_URL: 'http://127.0.0.1:41234' }
    )
  ).toEqual({
    MUPPET_RELAY_URL: 'http://127.0.0.1:41234',
    LD_LIBRARY_PATH: '/nix/store/gcc-lib/lib',
    NODE_ENV: 'production',
  });
  expect(joinEnvironment({}, {})).toEqual({ NODE_ENV: 'production' });
});
