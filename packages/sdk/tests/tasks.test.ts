import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Task.forPullRequest', () => {
  test('looks up the tasks a pull request references by its key', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        pullRequests: [
          {
            githubKey: 'macro-inc/macro/pull/12',
            taskIds: [
              '0198a4cc-e138-7670-a308-a6b766602710',
              '0198a4cc-e138-7670-a308-a6b766602711',
            ],
          },
        ],
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const tasks = await macro.tasks.forPullRequest(
      'https://github.com/macro-inc/macro/pull/12#discussion',
    );

    expect(tasks.map((task) => task.id)).toEqual([
      '0198a4cc-e138-7670-a308-a6b766602710',
      '0198a4cc-e138-7670-a308-a6b766602711',
    ]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(
      '/documents/github_prs/tasks',
    );
    expect(await requests[0].json()).toEqual({
      githubKeys: ['macro-inc/macro/pull/12'],
    });
  });

  test('rejects URLs that are not GitHub pull requests', async () => {
    const macro = new Macro({ token: 'user-token' });
    await expect(
      macro.tasks.forPullRequest(
        'https://github.com/macro-inc/macro/issues/12',
      ),
    ).rejects.toThrow('Expected a GitHub pull request URL');
  });
});

describe('Task.create', () => {
  test('sends initiative, assignees and due date with the create', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        documentId: '0198a4cc-e138-7670-a308-a6b766602720',
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const task = await macro.tasks.create({
      name: 'Fix imported timestamps',
      initiative: macro.initiatives.byId(
        '01a1793c-85f8-7961-885a-1718b0f00de5',
      ),
      assignees: [macro.users.byId('macro|someone@example.test')],
      dueDate: new Date('2026-10-29T04:00:00.000Z'),
    });

    expect(task.id).toBe('0198a4cc-e138-7670-a308-a6b766602720');
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe('/documents/create_task');
    expect(await requests[0].json()).toEqual({
      taskName: 'Fix imported timestamps',
      markdown: null,
      projectId: null,
      teamId: null,
      shareWithTeam: true,
      propertyValues: [
        {
          propertyId: '00000001-0000-0000-0000-000000000002',
          value: {
            type: 'select_option',
            option_id: '00000001-0000-0000-0002-000000000001',
          },
        },
        {
          propertyId: '00000001-0000-0000-0000-000000000001',
          value: {
            type: 'multi_entity_reference',
            references: [
              { entity_id: 'macro|someone@example.test', entity_type: 'USER' },
            ],
          },
        },
        {
          propertyId: '00000001-0000-0000-0000-000000000014',
          value: {
            type: 'entity_reference',
            reference: {
              entity_id: '01a1793c-85f8-7961-885a-1718b0f00de5',
              entity_type: 'INITIATIVE',
            },
          },
        },
        {
          propertyId: '00000001-0000-0000-0000-000000000004',
          value: { type: 'date', value: '2026-10-29T04:00:00.000Z' },
        },
      ],
    });
  });

  test('assigns the creator when an initiative is given without assignees', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      if (new URL(request.url).pathname === '/user/me') {
        return Response.json({ user_id: 'macro|creator@example.test' });
      }
      return Response.json({
        documentId: '0198a4cc-e138-7670-a308-a6b766602721',
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: {
        auth: 'https://auth.example.test',
        storage: 'https://storage.example.test',
      },
    });

    await macro.tasks.create({
      name: 'Default the agent selector to Auto',
      initiative: macro.initiatives.byId(
        '01a17930-ca75-7cd0-97e5-233140b4e491',
      ),
    });

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/user/me',
      '/documents/create_task',
    ]);
    expect((await requests[1].json()).propertyValues).toEqual([
      {
        propertyId: '00000001-0000-0000-0000-000000000002',
        value: {
          type: 'select_option',
          option_id: '00000001-0000-0000-0002-000000000001',
        },
      },
      {
        propertyId: '00000001-0000-0000-0000-000000000001',
        value: {
          type: 'multi_entity_reference',
          references: [
            { entity_id: 'macro|creator@example.test', entity_type: 'USER' },
          ],
        },
      },
      {
        propertyId: '00000001-0000-0000-0000-000000000014',
        value: {
          type: 'entity_reference',
          reference: {
            entity_id: '01a17930-ca75-7cd0-97e5-233140b4e491',
            entity_type: 'INITIATIVE',
          },
        },
      },
    ]);
  });

  test('keeps the service defaults when no properties are given', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        documentId: '0198a4cc-e138-7670-a308-a6b766602722',
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    await macro.tasks.create({ name: 'Plain task' });

    expect(requests).toHaveLength(1);
    expect((await requests[0].json()).propertyValues).toBeNull();
  });
});

describe('Task.summaries', () => {
  test('reads many task names in one request, in the order given', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        previews: [
          {
            type: 'access',
            document_id: '0198a4cc-e138-7670-a308-a6b766602731',
            document_name: 'Second task',
            owner: 'macro|owner@example.test',
            updated_at: '2026-10-27T10:00:00Z',
            sub_type: { type: 'task', is_completed: true },
          },
          {
            type: 'does_not_exist',
            document_id: '0198a4cc-e138-7670-a308-a6b766602732',
          },
          {
            type: 'access',
            document_id: '0198a4cc-e138-7670-a308-a6b766602730',
            document_name: 'First task',
            owner: 'macro|owner@example.test',
            updated_at: null,
            sub_type: { type: 'task', is_completed: false },
          },
        ],
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const summaries = await macro.tasks.summaries([
      macro.tasks.byId('0198a4cc-e138-7670-a308-a6b766602730'),
      macro.tasks.byId('0198a4cc-e138-7670-a308-a6b766602731'),
      macro.tasks.byId('0198a4cc-e138-7670-a308-a6b766602732'),
    ]);

    expect(
      summaries.map((summary) => ({
        id: summary.task.id,
        name: summary.name,
        owner: summary.owner.id,
        updatedAt: summary.updatedAt,
        completed: summary.completed,
      })),
    ).toEqual([
      {
        id: '0198a4cc-e138-7670-a308-a6b766602730',
        name: 'First task',
        owner: 'macro|owner@example.test',
        updatedAt: undefined,
        completed: false,
      },
      {
        id: '0198a4cc-e138-7670-a308-a6b766602731',
        name: 'Second task',
        owner: 'macro|owner@example.test',
        updatedAt: '2026-10-27T10:00:00Z',
        completed: true,
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe('/documents/preview');
    expect(await requests[0].json()).toEqual({
      document_ids: [
        '0198a4cc-e138-7670-a308-a6b766602730',
        '0198a4cc-e138-7670-a308-a6b766602731',
        '0198a4cc-e138-7670-a308-a6b766602732',
      ],
    });
  });
});

describe('InitiativeNamespace.summaries', () => {
  test('returns every initiative name from the one list request', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        initiatives: [
          {
            id: '01a17930-ca75-7cd0-97e5-233140b4e491',
            name: 'Agents',
            updatedAt: '2026-10-27T10:00:00Z',
          },
          {
            id: '01a1793c-85f8-7961-885a-1718b0f00de5',
            name: 'Document Editing',
            updatedAt: '2026-10-26T10:00:00Z',
          },
        ],
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const summaries = await macro.initiatives.summaries();

    expect(
      summaries.map((summary) => [summary.initiative.id, summary.name]),
    ).toEqual([
      ['01a17930-ca75-7cd0-97e5-233140b4e491', 'Agents'],
      ['01a1793c-85f8-7961-885a-1718b0f00de5', 'Document Editing'],
    ]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe('/initiatives');
  });
});

describe('TaskTemplate default titles', () => {
  test('creates a task title independently of the template name', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({
        id: '0198a4cc-e138-7670-a308-a6b766602740',
        name: 'Weekly review',
        revision: 1,
        configuration: {
          title: 'Review outstanding work',
          propertyIds: [],
          defaults: [],
          descriptionMarkdown: 'Review checklist',
        },
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const template = await macro.taskTemplates.create({
      name: 'Weekly review',
      title: 'Review outstanding work',
      descriptionMarkdown: 'Review checklist',
    });
    expect(await template.name()).toBe('Weekly review');
    expect(await template.title()).toBe('Review outstanding work');
    expect(requests).toHaveLength(1);
    expect(await requests[0].json()).toMatchObject({
      name: 'Weekly review',
      configuration: { title: 'Review outstanding work' },
    });
  });

  test('retains the saved title during property updates and supports clearing it', async () => {
    const requests: Request[] = [];
    let record = {
      id: '0198a4cc-e138-7670-a308-a6b766602740',
      name: 'Weekly review',
      revision: 1,
      configuration: {
        title: 'Review outstanding work',
        propertyIds: ['priority'],
        defaults: [],
        descriptionMarkdown: 'Review checklist',
      },
    };
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      if (request.method === 'PUT') {
        const body = await request.json();
        record = { ...record, ...body, revision: record.revision + 1 };
      }
      return Response.json(record);
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const template = macro.taskTemplates.byId(record.id);
    await template.update({ properties: [] });
    expect(await template.title()).toBe('Review outstanding work');
    await template.update({ title: '' });
    expect(await template.title()).toBe('');
    const writes = requests.filter((request) => request.method === 'PUT');
    expect(await writes[0].json()).toMatchObject({
      revision: 1,
      configuration: { title: 'Review outstanding work', propertyIds: [] },
    });
    expect(await writes[1].json()).toMatchObject({
      revision: 2,
      configuration: {
        title: '',
        propertyIds: [],
        descriptionMarkdown: 'Review checklist',
      },
    });
  });

  test('reads an existing template without a task title', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          id: '0198a4cc-e138-7670-a308-a6b766602740',
          name: 'Untitled tasks',
          revision: 1,
          configuration: { propertyIds: [], descriptionMarkdown: '' },
        }),
      { preconnect: originalFetch.preconnect },
    );
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    expect(
      await macro.taskTemplates
        .byId('0198a4cc-e138-7670-a308-a6b766602740')
        .title(),
    ).toBeUndefined();
  });
});

describe('TaskTemplate task sharing', () => {
  test.each([
    true,
    false,
    undefined,
  ])('creates and reads sharing %s independently of template ownership', async (sharing) => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      const body = await request.json();
      return Response.json({
        id: '0198a4cc-e138-7670-a308-a6b766602740',
        ...body,
        revision: 1,
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const template = await macro.taskTemplates.create({
      name: 'Reusable task',
      shareWithTeam: sharing,
    });
    expect(await template.shareWithTeam()).toBe(sharing);
    const body = await requests[0].json();
    expect(body.teamId).toBeUndefined();
    expect(body.configuration.shareWithTeam).toBe(sharing);
    expect(Object.hasOwn(body.configuration, 'shareWithTeam')).toBe(
      sharing !== undefined,
    );
  });

  test.each([
    true,
    false,
    undefined,
  ])('retains sharing %s on property updates and accepts an explicit replacement', async (sharing) => {
    const requests: Request[] = [];
    let record = {
      id: '0198a4cc-e138-7670-a308-a6b766602740',
      name: 'Reusable task',
      teamId: '0198a4cc-e138-7670-a308-a6b766602741',
      revision: 1,
      configuration: {
        shareWithTeam: sharing,
        propertyIds: ['priority'],
        defaults: [],
        descriptionMarkdown: '',
      },
    };
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      if (request.method === 'PUT') {
        const body = await request.json();
        record = { ...record, ...body, revision: record.revision + 1 };
      }
      return Response.json(record);
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const template = macro.taskTemplates.byId(record.id);
    await template.update({ properties: [] });
    expect(await template.shareWithTeam()).toBe(sharing);
    const replacement = sharing === false;
    await template.update({ shareWithTeam: replacement });
    expect(await template.shareWithTeam()).toBe(replacement);
    await template.update({ properties: [] });
    expect(await template.shareWithTeam()).toBe(replacement);
    await template.update({ name: 'Renamed template' });
    expect(await template.shareWithTeam()).toBe(replacement);
    const writes = requests.filter((request) => request.method === 'PUT');
    expect((await writes[0].json()).configuration.shareWithTeam).toBe(sharing);
    for (const request of writes.slice(1))
      expect((await request.json()).configuration.shareWithTeam).toBe(
        replacement,
      );
    expect(record.teamId).toBe('0198a4cc-e138-7670-a308-a6b766602741');
  });
});
