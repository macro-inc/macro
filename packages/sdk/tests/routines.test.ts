import { afterEach, expect, test } from 'bun:test';
import type { ScheduledActionResponse } from '../generated/scheduled-action/types.gen';
import { Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const record: ScheduledActionResponse = {
  id: 'routine-1',
  name: 'Daily report',
  kind: 'Agent',
  enabled: true,
  run_visibility: 'unlisted',
  configuration_revision: 1,
  owner: 'macro|owner@example.test',
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
  trigger: { type: 'cron', schedule: '0 9 * * *', timezone: 'UTC' },
  task: { prompt: 'Summarize', user_prompt: 'Daily summary' },
};
test('routine creation maps agent handles, seeds detail and uses shared auth and observation', async () => {
  const requests: Request[] = [];
  const events: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json(record, { status: 201 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'bot', token: 'mbot_test' },
    requestedAs: record.owner,
    hosts: { 'scheduled-action': 'https://routines.test' },
    onRequest: (e) => events.push(`${e.service}.${e.operation}:${e.status}`),
  });
  const routine = await macro.routines.create({
    name: 'Daily report',
    trigger: { type: 'cron', schedule: '0 9 * * *', timezone: 'UTC' },
    prompt: 'Summarize',
    userPrompt: 'Daily summary',
    agent: macro.agents.byId('agent-1'),
  });
  expect(await routine.name()).toBe('Daily report');
  expect((await routine.owner()).id).toBe(record.owner);
  expect(requests).toHaveLength(1);
  expect(await requests[0].json()).toEqual({
    name: 'Daily report',
    kind: 'Agent',
    enabled: true,
    trigger: record.trigger,
    task: {
      prompt: 'Summarize',
      user_prompt: 'Daily summary',
      agent: { bot_id: 'agent-1' },
    },
  });
  expect(requests[0].headers.get('x-macro-bot-token')).toBe('mbot_test');
  expect(requests[0].headers.get('x-macro-bot-for-macro-user-id')).toBe(
    record.owner,
  );
  expect(events).toEqual([
    'scheduled-action.createScheduledAction:started',
    'scheduled-action.createScheduledAction:completed',
  ]);
  expect(JSON.stringify(routine)).not.toContain('mbot_test');
});
test('routine writes invalidate detail only after success', async () => {
  let enabled = true;
  let reads = 0;
  let reject = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method !== 'GET') {
        if (reject)
          return Response.json({ error: 'forbidden' }, { status: 403 });
        enabled = false;
        return Response.json({ ...record, enabled });
      }
      reads++;
      return Response.json({ ...record, enabled });
    },
    { preconnect: originalFetch.preconnect },
  );
  const routine = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  }).routines.byId('routine-1');
  expect(reads).toBe(0);
  expect(await routine.enabled()).toBe(true);
  expect(await routine.enabled()).toBe(true);
  expect(reads).toBe(1);
  await routine.setEnabled(false);
  expect(await routine.enabled()).toBe(false);
  expect(reads).toBe(2);
  reject = true;
  await expect(routine.setEnabled(true)).rejects.toBeInstanceOf(MacroApiError);
  expect(await routine.enabled()).toBe(false);
  expect(reads).toBe(2);
});
test('routine execution returns typed transcript handles and scoped history', async () => {
  let resource: 'agent' | 'chat' = 'agent';
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.url.endsWith('/history'))
        return Response.json([
          {
            id: 'run-1',
            action_id: 'routine-1',
            created_at: '',
            start_time: '',
            end_time: '',
            is_success: true,
            result: {},
          },
        ]);
      return Response.json({
        action_id: 'routine-1',
        resource: { type: resource, id: 'transcript-1' },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const routine = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  }).routines.byId('routine-1');
  const agent = await routine.execute();
  expect(agent?.id).toBe('transcript-1');
  expect(agent && 'prompt' in agent).toBe(true);
  resource = 'chat';
  const chat = await routine.execute();
  expect(chat && 'history' in chat).toBe(true);
  const [run] = await routine.history();
  expect(run.routine).toBe(routine);
  expect(run.id).toBe('run-1');
});

test('routine options carry run visibility and updates that omit it keep it', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json({ ...record, run_visibility: 'listed' });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'bot', token: 'mbot_test' },
    requestedAs: record.owner,
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  const options = {
    name: 'Daily report',
    trigger: { type: 'cron', schedule: '0 9 * * *', timezone: 'UTC' },
    prompt: 'Summarize',
    userPrompt: 'Daily summary',
  } as const;
  const routine = await macro.routines.create({
    ...options,
    runVisibility: 'listed',
  });
  expect(await routine.runVisibility()).toBe('listed');
  await routine.update(options);
  expect(bodies[0]).toMatchObject({ run_visibility: 'listed' });
  expect(bodies[1]).not.toHaveProperty('run_visibility');
});
