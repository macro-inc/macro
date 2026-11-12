// Learning that the owner decided: by asking the vault on each wake and on a schedule while anything is pending.
import { expect, test } from 'bun:test';
import { noteAccess, pollAccess } from '../../../events/handlers/secrets.ts';
import { readPending, settle } from '../access.ts';
import { pollSchedule } from '../config.ts';
import { requestSecretAccess, searchSecrets } from '../index.ts';
import type { AccessRequestState } from '../wire.ts';
import { rig } from './rig.ts';

const login = {
  type: 'login' as const,
  username: 'ada',
  password: 'pw-0123456789abcdef',
};

/** The rig with two items asked for, and a stand-in for waking the agent. */
const asked = async () => {
  const setup = rig();
  const { context, stub } = setup;
  const shared = stub.add({ name: 'Shared', kind: 'login', secret: login });
  const other = stub.add({ name: 'Other', kind: 'login', secret: login });
  for (const item of await searchSecrets(context, {}))
    await requestSecretAccess(context, { item });
  const woken: string[] = [];
  const handling = {
    ...context,
    wake: async (request: string) => {
      woken.push(request);
      return { kind: 'done' as const, reply: '' };
    },
  };
  return { ...setup, shared, other, woken, handling };
};

const firing = (name: string) => ({ name, due: '2026-11-11T12:05:00Z' });

test('a poll while the owner has not decided wakes nobody and keeps polling', async () => {
  const { handling, woken, polling, context } = await asked();
  await pollAccess(firing('someone-elses'), handling);
  await pollAccess(firing(pollSchedule), handling);
  expect(woken).toEqual([]);
  expect(polling.on).toBe(true);
  expect((await readPending(context)).map(({ name }) => name)).toEqual([
    'Shared',
    'Other',
  ]);
});

test('a decision wakes the agent once, and polling stops when nothing is left', async () => {
  const { handling, woken, polling, stub, shared, other, context } =
    await asked();
  stub.owner.approve(shared, 'view');
  await pollAccess(firing(pollSchedule), handling);
  expect(woken).toHaveLength(1);
  expect(woken[0]).toContain('"Shared": approved: usable now');
  expect(woken[0]).not.toContain('Other');
  expect(polling.on).toBe(true);
  stub.owner.deny(other);
  await pollAccess(firing(pollSchedule), handling);
  expect(woken[1]).toContain('"Other": denied');
  expect(polling.on).toBe(false);
  expect(await readPending(context)).toEqual([]);
  await pollAccess(firing(pollSchedule), handling);
  expect(woken).toHaveLength(2);
});

test('every wake checks too, and is told what was decided', async () => {
  const { stub, shared, context } = await asked();
  stub.owner.approve(shared, 'edit');
  const added: string[] = [];
  await noteAccess({ add: (text) => added.push(text) }, context);
  expect(added).toEqual([
    '## Secrets you asked for\n\n- "Shared": approved: usable now',
  ]);
  added.length = 0;
  await noteAccess({ add: (text) => added.push(text) }, context);
  expect(added).toEqual([]);
});

test('an unreachable vault or a stale answer keeps a request waiting', () => {
  const request = { teamId: 't', itemId: 'i', name: 'N', revision: 3 };
  const pending = [request];
  const state = (revision: number, status: AccessRequestState['status']) => ({
    kind: 'ok' as const,
    status: 200,
    wake: 'w',
    value: {
      requestId: 'r',
      itemId: 'i',
      agentAccountId: 'a',
      permission: 'view' as const,
      status,
      revision,
      updatedAt: null,
      access: {
        status: 'request_access' as const,
        useBasis: null,
        canUpdate: false,
        canSetTotp: false,
        permissionRevision: 0,
        pendingRequestId: null,
      },
    },
  });
  expect(
    settle(
      pending,
      new Map([['i', { kind: 'refused', code: 'unreachable', wake: 'w' }]])
    ).waiting
  ).toEqual(pending);
  expect(settle(pending, new Map([['i', state(2, 'denied')]])).waiting).toEqual(
    pending
  );
  expect(
    settle(pending, new Map([['i', state(4, 'denied')]])).resolved
  ).toEqual([{ pending: request, outcome: 'denied' }]);
  expect(
    settle(
      pending,
      new Map([['i', { kind: 'refused', code: 'not_found', wake: 'w' }]])
    ).resolved
  ).toEqual([{ pending: request, outcome: 'gone' }]);
});
