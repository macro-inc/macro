import { afterEach, expect, test } from 'bun:test';
import type {
  CodeStep,
  RoutineKnob,
  ScheduledActionResponse,
} from '../generated/scheduled-action/types.gen';
import { Link } from '../src/entities/email/link';
import type { RoutineKnobOptions } from '../src/entities/routines/routine';
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
test('routine creation sends code and Ask AI steps that write as the user', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json(record, { status: 201 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  const steps = [
    {
      type: 'code',
      title: 'Post hello',
      source: 'export async function main() {}',
    },
    {
      type: 'agent',
      instructions: 'Summarize what the code posted.',
      agent: macro.agents.byId('agent-1'),
    },
  ] as const;
  const routine = await macro.routines.create({
    name: 'Hello as me',
    trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
    enabled: false,
    steps,
    dangerouslyOperateAsUser: true,
  });
  await routine.update({
    name: 'Hello as the agent',
    trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
    steps,
  });
  expect(bodies).toEqual([
    {
      name: 'Hello as me',
      kind: 'Agent',
      enabled: false,
      trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
      task: {
        steps: [
          {
            type: 'code',
            title: 'Post hello',
            source: 'export async function main() {}',
          },
          {
            type: 'agent',
            instructions: 'Summarize what the code posted.',
            agent: { bot_id: 'agent-1' },
          },
        ],
        dangerously_operate_as_user: true,
      },
    },
    {
      name: 'Hello as the agent',
      kind: 'Agent',
      trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
      task: {
        steps: [
          {
            type: 'code',
            title: 'Post hello',
            source: 'export async function main() {}',
          },
          {
            type: 'agent',
            instructions: 'Summarize what the code posted.',
            agent: { bot_id: 'agent-1' },
          },
        ],
      },
    },
  ]);
});

test('an email trigger sends and reads the inboxes it watches as handles', async () => {
  const bodies: ScheduledActionResponse[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const body = (await request.json()) as ScheduledActionResponse;
      bodies.push(body);
      return Response.json(
        { ...record, trigger: body.trigger },
        { status: 201 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  const inbox = macro.email.link('inbox-1');
  const routine = await macro.routines.create({
    name: 'Helpdesk',
    trigger: {
      type: 'events',
      filters: [{ events: ['email.message_received'], inboxes: [inbox] }],
    },
    prompt: 'Triage',
    userPrompt: 'Triage helpdesk mail',
  });
  expect(bodies).toMatchObject([
    {
      trigger: {
        type: 'events',
        filters: [{ events: ['email.message_received'], inboxes: ['inbox-1'] }],
      },
    },
  ]);
  // Read back, a picked inbox is a handle again, not its id.
  const trigger = await routine.trigger();
  if (trigger.type !== 'events') throw new Error(`read ${trigger.type}`);
  const [read] = trigger.filters[0]?.inboxes ?? [];
  expect(read).toBeInstanceOf(Link);
  expect(read?.id).toBe('inbox-1');
});

test('an entity knob takes the handle of the item it names, a task included, and sends its id', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json({ ok: true, problems: [], steps: [], routine: {} });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  await macro.routines.check({
    name: 'Post open bugs',
    trigger: { type: 'cron', schedule: '0 0 9 * * MON', timezone: 'UTC' },
    steps: [
      {
        type: 'code',
        title: 'Post open bugs',
        source:
          "export async function main({ knobs }: StepContext) { await knobs.bugs.send('Open bugs'); }",
        knobs: [
          {
            type: 'entity',
            name: 'bugs',
            label: 'Channel to post in',
            entity_types: ['channel'],
            value: {
              type: 'channel',
              entity: macro.channels.byId('channel-1'),
            },
          },
          {
            type: 'entity',
            name: 'task',
            label: 'Task to follow',
            entity_types: ['task', 'email_thread'],
            value: { type: 'task', entity: macro.tasks.byId('task-1') },
          },
          { type: 'number', name: 'days', label: 'Days', value: 7 },
        ],
      },
    ],
  });
  expect(bodies[0]).toMatchObject({
    routine: {
      task: {
        steps: [
          {
            knobs: [
              {
                type: 'entity',
                name: 'bugs',
                label: 'Channel to post in',
                entity_types: ['channel'],
                value: { type: 'channel', id: 'channel-1' },
              },
              {
                type: 'entity',
                name: 'task',
                label: 'Task to follow',
                entity_types: ['task', 'email_thread'],
                value: { type: 'task', id: 'task-1' },
              },
              { type: 'number', name: 'days', label: 'Days', value: 7 },
            ],
          },
        ],
      },
    },
  });
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

test('routine options carry the agent’s pick of a look, and updates that omit it keep the stored one', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json(record);
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
  const appearance = {
    icon: { kind: 'macro', name: 'chart-bar' },
    color: 'blue',
  } as const;
  const routine = await macro.routines.create({ ...options, appearance });
  await routine.update(options);
  await macro.routines.check({ ...options, appearance });
  expect(bodies[0]).toMatchObject({ appearance });
  expect(bodies[1]).not.toHaveProperty('appearance');
  expect(bodies[2]).toMatchObject({ routine: { appearance } });
});

test('a rejected routine create carries the server validation message', async () => {
  const rejection =
    'invalid routine task; select a model or agent and provide instructions';
  globalThis.fetch = Object.assign(
    async () =>
      new Response(rejection, {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      }),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  await expect(
    macro.routines.create({
      name: 'Check in',
      trigger: { type: 'cron', schedule: '0 */10 * * * *', timezone: 'UTC' },
      prompt: 'Check in',
      userPrompt: 'Check in',
      model: 'model',
    }),
  ).rejects.toMatchObject({
    name: 'MacroApiError',
    status: 400,
    message: `Macro API error 400: ${rejection}`,
    data: rejection,
  });
});

test('MacroApiError messages carry the message or error of a JSON body', () => {
  expect(new MacroApiError(403, { message: 'Forbidden' }).message).toBe(
    'Macro API error 403: Forbidden',
  );
  expect(new MacroApiError(409, { error: 'already running' }).message).toBe(
    'Macro API error 409: already running',
  );
  expect(new MacroApiError(500, {}).message).toBe('Macro API error 500');
  expect(new MacroApiError(502, 'x'.repeat(600)).message).toBe(
    `Macro API error 502: ${'x'.repeat(500)}…`,
  );
});

test('routine apps become the task the routine requires them in, only when given', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json(record, { status: 201 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'bot', token: 'mbot_test' },
    requestedAs: record.owner,
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  const steps = [{ type: 'agent', instructions: 'File it' }] as const;
  const trigger = {
    type: 'cron',
    schedule: '0 0 9 * * *',
    timezone: 'UTC',
  } as const;
  await macro.routines.create({
    name: 'Bugs',
    trigger,
    steps,
    apps: [{ slug: 'linear', name: 'Linear' }],
  });
  const routine = await macro.routines.create({ name: 'Bugs', trigger, steps });
  await routine.update({ name: 'Bugs', trigger, steps, apps: [] });

  expect(bodies[0].task).toMatchObject({
    mcp_servers: [{ app_slug: 'linear', server_name: 'Linear' }],
  });
  expect(bodies[1].task).not.toHaveProperty('mcp_servers');
  // An update removes them by naming none.
  expect(bodies[2].task).toMatchObject({ mcp_servers: [] });
});

test('a check names the apps a routine needs that are not connected', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json({
        ok: true,
        problems: [],
        steps: [],
        routine: record,
        missingApps: [{ app_slug: 'notion', server_name: 'Notion' }],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'bot', token: 'mbot_test' },
    requestedAs: record.owner,
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  const routine = {
    name: 'Bugs',
    trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
    steps: [{ type: 'agent', instructions: 'File it' }],
  } as const;

  const check = await macro.routines.check(routine, {
    missingApps: [{ slug: 'notion', name: 'Notion' }],
  });
  await macro.routines.check(routine);

  expect(bodies[0]).toMatchObject({
    missingApps: [{ app_slug: 'notion', server_name: 'Notion' }],
  });
  expect(check.missingApps).toEqual([
    { app_slug: 'notion', server_name: 'Notion' },
  ]);
  // A check naming none sends none, so it reaches a server without them.
  expect(bodies[1]).not.toHaveProperty('missingApps');
});

test('a stored code step passes back with its picked items as handles, and its unpicked knobs as null', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      bodies.push(await request.json());
      return Response.json(record);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'user',
    hosts: { 'scheduled-action': 'https://routines.test' },
  });
  // As the routine stores it: entity knobs hold `{ type, id }`, or nothing.
  const stored: CodeStep = {
    id: 'step-1',
    title: 'Post open bugs',
    source:
      "export async function main({ knobs }: StepContext) { await knobs.bugs.send('Open bugs'); }",
    knobs: [
      {
        type: 'entity',
        name: 'bugs',
        label: 'Channel to post in',
        entity_types: ['channel'],
        value: { type: 'channel', id: 'channel-1' },
      },
      {
        type: 'entity',
        name: 'next',
        label: 'Task to follow',
        entity_types: ['task'],
        value: null,
      },
      {
        type: 'entity',
        name: 'later',
        label: 'Project to file in',
        entity_types: ['project'],
      },
    ],
  };
  // Each picked item given again as its handle, as a caller passes it back.
  const handles = (knob: RoutineKnob): RoutineKnobOptions => {
    if (knob.type !== 'entity') return knob;
    const { value, ...rest } = knob;
    return {
      ...rest,
      value:
        value?.type === 'channel'
          ? { type: 'channel', entity: macro.channels.byId(value.id) }
          : null,
    };
  };
  const knobs = (stored.knobs ?? []).map(handles);
  const asStored: RoutineKnobOptions = {
    type: 'entity',
    name: 'bugs',
    label: 'Channel to post in',
    entity_types: ['channel'],
    // @ts-expect-error A knob takes the item's handle, never its id.
    value: { type: 'channel', id: 'channel-1' },
  };
  expect(asStored.type).toBe('entity');
  await macro.routines.byId('routine-1').update({
    name: 'Post open bugs',
    trigger: { type: 'cron', schedule: '0 0 9 * * MON', timezone: 'UTC' },
    steps: [{ type: 'code', ...stored, knobs }],
  });
  expect(bodies[0]).toMatchObject({
    task: {
      steps: [
        {
          knobs: [
            { name: 'bugs', value: { type: 'channel', id: 'channel-1' } },
            { name: 'next', value: null },
            { name: 'later', value: null },
          ],
        },
      ],
    },
  });
});
