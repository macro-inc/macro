import { afterEach, expect, test } from 'bun:test';
import type { TaskTemplate as TaskTemplateRecord } from '../generated/storage/types.gen';
import { PropertyDefinition } from '../src/entities/properties/property-definition';
import { Macro, TaskTemplate } from '../src/macro';

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

const record: TaskTemplateRecord = {
  id: '0198a4cc-e138-7670-a308-a6b766602740',
  userId: null,
  teamId: '0198a4cc-e138-7670-a308-a6b766602750',
  creatorId: 'macro|user@example.com',
  name: 'Example template',
  canManage: true,
  configuration: {
    propertyIds: [
      '0198a4cc-e138-7670-a308-a6b766602730',
      '0198a4cc-e138-7670-a308-a6b766602731',
    ],
    defaults: [
      {
        propertyId: '0198a4cc-e138-7670-a308-a6b766602730',
        value: { type: 'number', value: 0 },
      },
    ],
    descriptionMarkdown: '- [ ] Describe the task',
  },
  revision: 3,
  createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z',
};

test('lists scoped template handles with seeded details and blank property handles', async () => {
  const requests: URL[] = [];
  server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json([record]);
    },
  });
  const macro = new Macro({
    token: 'user-token',
    hosts: { storage: server.url.origin },
  });
  const templates = await macro.taskTemplates.list({
    team: macro.teams.byId('0198a4cc-e138-7670-a308-a6b766602750'),
  });
  expect(templates).toHaveLength(1);
  const template = templates[0];
  expect(template).toBeInstanceOf(TaskTemplate);
  expect(await template.name()).toBe(record.name);
  expect((await template.team())?.id).toBe(
    '0198a4cc-e138-7670-a308-a6b766602750',
  );
  const properties = await template.properties();
  expect(properties[0].property).toBeInstanceOf(PropertyDefinition);
  expect(properties[0].defaultValue).toEqual({ type: 'number', value: 0 });
  expect(properties[1].defaultValue).toBeUndefined();
  expect(requests).toHaveLength(1);
  expect(requests[0].pathname).toBe('/task_templates');
  expect(requests[0].searchParams.get('teamId')).toBe(
    '0198a4cc-e138-7670-a308-a6b766602750',
  );
  expect(JSON.stringify(template)).not.toContain('user-token');
});

test('creates templates from property and team handles while retaining zero and false defaults', async () => {
  const bodies: unknown[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      bodies.push(body);
      return Response.json(record, { status: 201 });
    },
  });
  const macro = new Macro({
    token: 'user-token',
    hosts: { storage: server.url.origin },
  });
  const template = await macro.taskTemplates.create({
    idempotencyKey: '0198a4cc-e138-7670-a308-a6b766602740',
    name: 'Example template',
    team: macro.teams.byId('0198a4cc-e138-7670-a308-a6b766602750'),
    descriptionMarkdown: '- [ ] Describe the task',
    properties: [
      {
        property: macro.properties.definition(
          '0198a4cc-e138-7670-a308-a6b766602730',
        ),
        defaultValue: { type: 'number', value: 0 },
      },
      {
        property: macro.properties.definition(
          '0198a4cc-e138-7670-a308-a6b766602731',
        ),
      },
      {
        property: macro.properties.definition(
          '0198a4cc-e138-7670-a308-a6b766602732',
        ),
        defaultValue: { type: 'boolean', value: false },
      },
    ],
  });
  expect(template).toBeInstanceOf(TaskTemplate);
  expect(template.id).toBe(record.id);
  expect(bodies).toEqual([
    {
      id: '0198a4cc-e138-7670-a308-a6b766602740',
      name: 'Example template',
      teamId: '0198a4cc-e138-7670-a308-a6b766602750',
      configuration: {
        propertyIds: [
          '0198a4cc-e138-7670-a308-a6b766602730',
          '0198a4cc-e138-7670-a308-a6b766602731',
          '0198a4cc-e138-7670-a308-a6b766602732',
        ],
        defaults: [
          {
            propertyId: '0198a4cc-e138-7670-a308-a6b766602730',
            value: { type: 'number', value: 0 },
          },
          {
            propertyId: '0198a4cc-e138-7670-a308-a6b766602732',
            value: { type: 'boolean', value: false },
          },
        ],
        descriptionMarkdown: '- [ ] Describe the task',
      },
    },
  ]);
});

test('invalidates observed details after updates and deletes at the next observed revision', async () => {
  let current = record;
  const requests: Array<{ method: string; url: URL; body?: unknown }> = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const entry: { method: string; url: URL; body?: unknown } = {
        method: request.method,
        url: new URL(request.url),
      };
      if (request.method === 'PUT') {
        entry.body = await request.json();
        current = { ...record, revision: 4, name: 'Updated template' };
      }
      requests.push(entry);
      return request.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json(current);
    },
  });
  const macro = new Macro({
    token: 'user-token',
    hosts: { storage: server.url.origin },
  });
  const template = macro.taskTemplates.byId(record.id);
  await template.update({ name: 'Updated template' });
  expect(await template.name()).toBe('Updated template');
  await template.delete();
  expect(requests.map((request) => request.method)).toEqual([
    'GET',
    'PUT',
    'GET',
    'DELETE',
  ]);
  expect(requests[1].body).toEqual({
    revision: 3,
    name: 'Updated template',
    configuration: record.configuration,
  });
  expect(requests[3].url.searchParams.get('revision')).toBe('4');
});

test('does not refetch and replay a shared edit after a revision conflict', async () => {
  const methods: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(request) {
      methods.push(request.method);
      return request.method === 'PUT'
        ? Response.json(
            { message: 'task template revision conflict' },
            { status: 409 },
          )
        : Response.json(record);
    },
  });
  const macro = new Macro({
    token: 'user-token',
    hosts: { storage: server.url.origin },
  });
  const template = macro.taskTemplates.byId(record.id);
  await expect(template.update({ name: 'Stale edit' })).rejects.toThrow();
  expect(methods).toEqual(['GET', 'PUT']);
  expect(await template.revision()).toBe(3);
});
