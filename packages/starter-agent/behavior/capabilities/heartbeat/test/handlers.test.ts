import { expect, test } from 'bun:test';
import type { Agent, Woke } from '@macro-inc/muppet/core/agent';
import { behavior } from '@macro-inc/muppet/core/behavior';
import { channel } from '@macro-inc/muppet/core/event';
import { parallel } from '@macro-inc/muppet/runtimes/parallel';
import {
  type Fired,
  memoryStore,
  scheduler,
} from '@macro-inc/muppet/utilities/schedules';
import { budgeted, fileLedger, recordSpend } from '../../../agent/budget.ts';
import { passthrough } from '../../../agent/claude.ts';
import { config as makeConfig } from '../../../context/config.ts';
import { memoryCredentials } from '../../../context/credentials.ts';
import type { Base } from '../../../context/index.ts';
import { log as makeLog } from '../../../context/log.ts';
import type { Ran, Shell } from '../../../context/shell.ts';
import { state as makeState } from '../../../context/state.ts';
import { fixedClock, join, memoryDisk } from '../../../context/test/fakes.ts';
import { heartbeatHandlers } from '../../../events/handlers/heartbeat.ts';
import { logs, paths } from '../config.ts';
import type { HeartbeatContext } from '../context.ts';
import { heartbeatCapabilities } from '../index.ts';
import { tick } from '../schedules.ts';

const root = '/agent';
const owner = 'macro|owner@example.com';
const ok = (stdout = ''): Ran => ({ code: 0, stdout, stderr: '' });
const no: Ran = { code: 1, stdout: '', stderr: '' };

/** The agent with a stand-in for itself, for Macro, for git, and firings pushed by hand. */
const setup = () => {
  const disk = memoryDisk();
  const clock = fixedClock('2026-11-09T15:00:00Z');
  const config = makeConfig({
    root,
    home: '/home/owner',
    join,
    settings: {
      owner,
      me: 'macro|agent@example.com',
      name: 'Agent',
      email: 'agent@example.com',
      timeZone: 'America/New_York',
      model: 'claude-opus-5-5',
    },
  });
  const state = makeState({ root, join });
  const ran: string[] = [];
  /** Who each commit was made as. */
  const authors: string[] = [];
  /** What another area hands the heartbeat to watch; empty is nothing. */
  const watched = { section: '' };
  // A repository with no remote and something to commit.
  const shell: Shell = {
    run: async (argv, options) => {
      const line = argv.join(' ');
      ran.push(line);
      if (line.includes('commit -qm'))
        authors.push(
          `${options?.env?.GIT_AUTHOR_NAME} <${options?.env?.GIT_AUTHOR_EMAIL}>`
        );
      if (line.includes('remote get-url')) return no;
      if (line.includes('diff --cached --quiet')) return no;
      return ok();
    },
    start: () => {
      throw new Error('nothing is started');
    },
    alive: () => false,
  };
  const base: Base = {
    config,
    state,
    disk,
    files: disk,
    clock,
    shell,
    credentials: memoryCredentials(),
    log: makeLog({ directory: state.log('agent'), join, disk, clock }),
    join,
    macro: async () => {
      throw new Error('Macro is not reached');
    },
    environment: async () => ({}),
    relay: async () => {
      throw new Error('no relay');
    },
    relayed: async () => ({}),
    trace: passthrough,
    sandbox: [],
  };
  const lock = { held: false };
  const heartbeat: HeartbeatContext['heartbeat'] = {
    paths: paths({ state, join }),
    stateRoot: join(root, 'state'),
    buckets: {
      memory: join(root, 'state', 'memory'),
      private: join(root, 'state', 'private'),
      run: join(root, 'state', 'run'),
      log: join(root, 'state', 'log'),
    },
    lock: async () => {
      if (lock.held) return undefined;
      lock.held = true;
      return {
        release: () => {
          lock.held = false;
        },
      };
    },
    tree: { entries: async () => [] },
    digest: (text) => new Bun.CryptoHasher('sha256').update(text).digest('hex'),
    scratch: { make: async () => '/scratch', remove: async () => undefined },
    sections: [async () => watched.section],
    prune: [],
    restart: undefined,
    awake: new Map(),
  };

  const wakes: { request: string; end: (woke: Woke) => void }[] = [];
  const agent: Agent = {
    wake: ({ request }) =>
      new Promise<Woke>((end) => {
        wakes.push({ request, end });
      }),
  };
  const sent: string[] = [];
  const schedules = scheduler({
    store: memoryStore(),
    clock,
    tz: config.timeZone,
  });
  const firings = channel<Fired>();
  const agentBehavior = behavior()
    .decorate(base)
    .decorate({ agent, schedules, heartbeat })
    .decorate({
      chat: {
        dm: async (userId: string, text: string) => {
          sent.push(`${userId}: ${text}`);
          return { channelId: 'c', messageId: 'm' };
        },
      },
    })
    .use(heartbeatCapabilities)
    .use(heartbeatHandlers({ sources: { schedules: firings.source } }))
    .on(
      (sources) => sources.hooks.failed,
      async ({ kind, error }) => {
        sent.push(`failed ${kind}: ${error}`);
      }
    );
  const running = agentBehavior.run(
    parallel({
      systemPrompt: '',
      load: async () => {
        throw new Error('no script is run');
      },
      signatures: async () => '',
      script: { file: join(root, 'script.ts'), name: 'Script' },
    })
  );
  /** Lets everything already resolved run, without any time passing. */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 50; turn += 1)
      await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const fire = async (name: string, data?: Fired['data']): Promise<void> => {
    await settle();
    await firings.push({
      name,
      due: '2026-11-09T15:00:00Z',
      ...(data === undefined ? {} : { data }),
    });
  };
  const logged = async (stream: string): Promise<readonly unknown[]> =>
    ((await disk.read(base.log.file(stream))) ?? '')
      .split('\n')
      .filter((line) => line !== '')
      .map((line): unknown => JSON.parse(line));
  const commits = () =>
    ran.flatMap((line) => line.match(/commit -qm (.*)$/)?.[1] ?? []);
  return {
    disk,
    watched,
    ran,
    authors,
    heartbeat,
    schedules,
    wakes,
    sent,
    fire,
    settle,
    logged,
    commits,
    stop: async () => {
      firings.close();
      await running;
    },
  };
};

test('a tick wakes the agent without waiting for it, holds the next tick while it runs, and commits when it is done', async () => {
  const box = setup();
  box.watched.section = '## Leftovers\n- a';
  await box.fire(tick);
  expect(box.wakes).toHaveLength(1);
  expect(box.wakes[0]?.request).toContain(
    '## Why you woke: snapshot changed\n## Snapshot now\n## Leftovers\n- a'
  );
  expect(box.commits()).toEqual(['sync: changes made outside a run']);

  // The next half hour comes while it is still working.
  await box.fire(tick);
  expect(box.wakes).toHaveLength(1);
  expect(await box.logged(logs.heartbeat)).toContainEqual(
    expect.objectContaining({ woke: false, held: true })
  );

  box.wakes[0]?.end({ kind: 'done', reply: 'done' });
  await box.settle();
  expect(box.commits().at(-1)).toBe('tick: ok (snapshot changed)');
  expect(box.heartbeat.awake.size).toBe(0);
  expect(await box.disk.read(box.heartbeat.paths.cursor)).toContain(
    '"lastRun": "2026-11-09T15:00:00Z"'
  );

  // Nothing changed since: the next tick leaves it asleep.
  await box.fire(tick);
  await box.settle();
  expect(box.wakes).toHaveLength(1);
  expect((await box.logged(logs.schedules)).length).toBe(3);
  await box.stop();
});

test('with nothing watched and a healthy repository, a tick commits and wakes nobody', async () => {
  const box = setup();
  await box.fire(tick);
  await box.fire(tick);
  await box.settle();
  expect(box.wakes).toHaveLength(0);
  expect(box.commits()).toEqual([
    'sync: changes made outside a run',
    'sync: changes made outside a run',
  ]);
  await box.stop();
});

test("with no remote nothing is pulled or pushed, nothing is asked of GitHub, and the commit is still the agent's", async () => {
  const box = setup();
  await box.fire(tick);
  await box.settle();
  expect(box.ran.some((line) => / (push|pull) /.test(line))).toBe(false);
  expect(box.ran.some((line) => line.startsWith('gh '))).toBe(false);
  expect(box.authors).toEqual(['Agent <agent@example.com>']);
  await box.stop();
});

test('a wake refused for the budget tells the owner once, and commits nothing', async () => {
  const box = setup();
  const disk = memoryDisk();
  const clock = fixedClock('2026-11-09T15:00:00Z');
  const ledger = fileLedger({ disk, join, directory: '/budget' });
  await recordSpend({ ledger, clock, timeZone: 'UTC' })({
    event: 'x',
    cost_usd: 1,
  });
  const over = budgeted({
    agent: { wake: async () => ({ kind: 'done', reply: '' }) },
    ledger,
    caps: { perDayUsd: 1 },
    clock,
    timeZone: 'UTC',
  });
  const refusals = await Promise.all(
    [0, 1].map(async () => {
      const woke = await over.wake({
        request: '',
        systemPrompt: '',
        event: { name: 'schedules', payload: {} },
        state: {
          code: {
            catalog: '',
            script: { file: '', name: '' },
            execute: async () => ({ kind: 'failed', error: '', logs: '' }),
            describe: async () => '',
          },
        },
      });
      return woke.kind === 'failed' ? woke.error : '';
    })
  );

  box.watched.section = '## Leftovers\n- a';
  await box.fire(tick);
  const before = box.commits().length;
  box.wakes[0]?.end({ kind: 'failed', error: refusals[0] ?? '' });
  await box.settle();
  await box.fire('standing', { wake: 'again' });
  await box.settle();
  box.wakes[1]?.end({ kind: 'failed', error: refusals[1] ?? '' });
  await box.settle();
  const told = box.sent.filter((line) => line.startsWith(`${owner}: `));
  expect(told).toHaveLength(1);
  expect(told[0]).toContain('daily cap');
  expect(box.commits()).toHaveLength(before);
  await box.stop();
});

test('a run that fails is still committed, and says so', async () => {
  const box = setup();
  box.watched.section = '## Leftovers\n- a';
  await box.fire(tick);
  box.wakes[0]?.end({ kind: 'failed', error: 'timed out' });
  await box.settle();
  expect(box.commits().at(-1)).toBe('tick: failed (snapshot changed)');
  await box.stop();
});

test('schedules that say what they do: a line to the owner, a wake, a watch; other names are left to their owners', async () => {
  const box = setup();
  await box.schedules.set('nudge', { at: '2026-11-09T15:00:00Z' });
  await box.schedules.set('watch', { every: '10m' });
  await box.schedules.set('standing', { every: '10m' });

  await box.fire('mail-review');
  await box.fire('standing', { dmOwner: 'every time' });
  await box.fire('nudge', { dmOwner: 'the thing' });
  await box.fire('watch', { dmOwner: 'delivered', ifFile: '/tmp/DELIVERED' });
  await box.settle();
  expect(box.sent).toEqual([`${owner}: every time`, `${owner}: the thing`]);
  // A one-shot that fired leaves; a recurring one and a watch still waiting stay.
  expect((await box.schedules.list()).map(({ name }) => name).sort()).toEqual([
    'standing',
    'watch',
  ]);

  await box.disk.write('/tmp/DELIVERED', '');
  await box.fire('watch', { dmOwner: 'delivered', ifFile: '/tmp/DELIVERED' });
  await box.settle();
  expect(box.sent.at(-1)).toBe(`${owner}: delivered`);
  expect((await box.schedules.list()).map(({ name }) => name)).toEqual([
    'standing',
  ]);

  await box.fire('standing', { wake: 'check the deploy' });
  await box.settle();
  expect(box.wakes.map(({ request }) => request)).toEqual(['check the deploy']);
  box.wakes[0]?.end({ kind: 'done', reply: '' });
  await box.settle();
  expect(box.commits().at(-1)).toBe('standing: ok');
  await box.stop();
});
