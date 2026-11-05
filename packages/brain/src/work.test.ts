import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { SpendLedger } from './budget.ts';
import { AsyncQueue } from './channel.ts';
import type { Conversation } from './control.ts';
import { Pool } from './pool.ts';
import type { Outcome, RunEvent, RunHandle, Runner, Turn } from './runner.ts';
import { Work } from './work.ts';
import { gitCli } from './workspace.ts';

test('a hand-off becomes a task and a run in its own worktree; follow-ups are injected; the result is reported where it came from', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-work-')
  );
  const git = gitCli(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'ada@example.com']);
  await git(['config', 'user.name', 'Ada']);
  await nodeFs.writeFile(`${root}/OPERATING.md`, '# Ada\n');
  await git(['add', '-A']);
  await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  const started: Turn[] = [];
  const injected: string[] = [];
  const finish = Promise.withResolvers<Outcome>();
  const runner: Runner = {
    start(turn): RunHandle {
      started.push(turn);
      return {
        events: new AsyncQueue<RunEvent>(),
        inject: (message) => injected.push(message),
        abort: () => {},
        done: finish.promise,
      };
    },
  };
  const pool = new Pool({
    runner,
    limits: { respond: 1, heartbeat: 1, work: 1 },
    budget: async () => ({
      perRunUsd: { respond: 3, heartbeat: 3, work: 20 },
      perDayUsd: 50,
    }),
    ledger: new SpendLedger(`${root}/cache`),
    log: () => {},
  });
  const reports: [Conversation, string][] = [];
  const commits: string[] = [];
  const work = new Work({
    pool,
    limit: 1,
    tasks: {
      create: async (name) => ({
        id: 'task-1',
        url: `https://macro.com/app/task/task-1#${name}`,
      }),
    },
    git,
    workDir: `${root}/work`,
    turn: async (task) => ({
      prompt: `do ${task.url}`,
      system: 'You are Ada.',
      model: 'claude-opus-5-5',
      env: {},
    }),
    report: async (conversation, text) => {
      reports.push([conversation, text]);
    },
    commit: async (turnId, summary) => {
      commits.push(`${turnId}: ${summary}`);
    },
    log: () => {},
  });
  const conversation = { channel: 'channel-1', root: 'root-1' };
  const task = await work.start(
    conversation,
    'fix invoice',
    'fix the March invoice'
  );
  assert.deepEqual(task.id, 'task-1');
  assert.deepEqual(started[0]?.cwd, `${root}/work/task-1`);
  assert.deepEqual(
    (await nodeFs.stat(`${root}/work/task-1/OPERATING.md`)).isFile(),
    true
  );
  await assert.rejects(
    () => work.start(conversation, 'again', 'fix it again'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('already running for this conversation')
  );
  const delivered = work.inject('channel-1.root-1', [
    {
      id: 'message-3',
      channelId: 'channel-1',
      channel: 'billing',
      root: 'root-1',
      thread: 'root-1',
      dm: false,
      from: 'macro|bo@example.com',
      at: '2026-11-04T10:03:00Z',
      text: 'use the new rate',
      mentionsMe: false,
    },
  ]);
  assert.deepEqual(delivered, true);
  assert.deepEqual(injected.length, 1);
  finish.resolve({
    status: 'success',
    result: 'Fixed the March invoice with the new rate.',
    costUsd: 2,
    sessionId: 'session-1',
  });
  await work.settled();
  assert.deepEqual(reports, [
    [conversation, 'Fixed the March invoice with the new rate.'],
  ]);
  assert.deepEqual(commits, ['work-task-1: work fix invoice: success']);
  assert.deepEqual(work.inject('channel-1.root-1', []), false);
  const worktrees = await git(['worktree', 'list', '--porcelain']);
  assert.deepEqual(worktrees.stdout.includes('work/task-1'), false);
});
