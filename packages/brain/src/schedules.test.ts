import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { type RoutineRecord, type Routines, Schedules } from './schedules.ts';
import { GitWriter, gitCli, Workspace } from './workspace.ts';

test('a schedule is a routine named for its note, and its run wakes the brain with that note', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-schedules-')
  );
  const workspace = new Workspace(root);
  const created: object[] = [];
  const live: RoutineRecord[] = [];
  const routines: Routines = {
    create: async (options) => {
      created.push(options);
      const routine = { id: 'routine-1', name: options.name };
      live.push(routine);
      return routine;
    },
    list: async () => live,
    delete: async () => {},
  };
  const schedules = new Schedules(
    workspace,
    new GitWriter(workspace, gitCli(root)),
    routines,
    'anthropic/claude-haiku-4-5'
  );
  await schedules.create('check whether Bo paid the March invoice', {
    type: 'once',
    at: '2026-11-06T09:00:00Z',
  });
  assert.deepEqual(created, [
    {
      name: 'wake: check whether Bo paid the March invoice',
      prompt:
        'This routine only wakes its owner. Reply "ok" and stop; do nothing else.',
      model: 'anthropic/claude-haiku-4-5',
      trigger: { type: 'once', at: '2026-11-06T09:00:00Z' },
    },
  ]);
  const wake = await schedules.wakeFor(
    {
      identity: {
        session_id: 'session-1',
        session_name: 'wake: check whether Bo paid the March invoice',
        owner_id: 'macro|ada@example.com',
        source: 'routine',
      },
    },
    'macro|ada@example.com'
  );
  assert.deepEqual(
    wake?.schedule?.note,
    'check whether Bo paid the March invoice'
  );
  const someoneElses = await schedules.wakeFor(
    {
      identity: {
        session_id: 'session-2',
        session_name: 'wake: check whether Bo paid the March invoice',
        owner_id: 'macro|bo@example.com',
        source: 'routine',
      },
    },
    'macro|ada@example.com'
  );
  assert.deepEqual(someoneElses, null);
  live.length = 0;
  assert.deepEqual(await schedules.reconcile(), 1);
  assert.deepEqual(await schedules.list(), []);
});
