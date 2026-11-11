import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BookingLinkDraft } from '../../sdk/generated/calendar/types.gen';
import { Macro } from '../../sdk/src/macro';
import { runOperation } from './call';
import { catalog, handleClasses } from './generated/catalog';
import { InputValidators } from './validate';

const validators = new InputValidators(catalog);

function operation(name: string) {
  const found = catalog.operations.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

type Recorded = { method: string; url: string; body: string | undefined };

/** A Macro client whose requests answer from `respond`, recording each. */
function macroAnswering(respond: (request: Recorded) => Response) {
  const requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = request.body ? await request.text() : undefined;
      const recorded = { method: request.method, url: request.url, body };
      requests.push(recorded);
      return respond(recorded);
    }
  );
  const macro = new Macro({
    token: 'test-token',
    env: 'dev',
    hosts: {
      storage: 'https://storage.test',
      calendar: 'https://calendar.test',
    },
    webAppUrl: 'https://app.test',
  });
  return { macro, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runOperation', () => {
  test.each([
    'initiative-1',
    'https://macro.com/app/initiative/initiative-1',
    'https://macro.com/app/projects/initiative-1/overview/?tab=tasks',
  ])('task creation accepts initiative reference %s', async (initiative) => {
    const { macro, requests } = macroAnswering(() =>
      Response.json({ documentId: 'task-1' })
    );

    const result = await runOperation({
      operation: operation('tasks.create'),
      input: { opts: { name: 'Follow up', initiative, assignees: [] } },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(result.isError).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]?.body ?? '')).toMatchObject({
      propertyValues: expect.arrayContaining([
        expect.objectContaining({
          value: {
            type: 'entity_reference',
            reference: { entity_id: 'initiative-1', entity_type: 'INITIATIVE' },
          },
        }),
      ]),
    });
  });

  test('a failed URL reload preserves a successful booking link edit', async () => {
    const draft: BookingLinkDraft = {
      event: {
        title: 'Intro',
        slug: 'intro',
        description: '',
        durationMinutes: 30,
        location: '',
        googleMeet: false,
        enabled: true,
        mode: 'individual',
        hosts: ['macro|owner@example.com'],
        beforeMinutes: 0,
        afterMinutes: 0,
        noticeMinutes: 60,
        horizonDays: 30,
        intervalMinutes: 30,
        requiresConfirmation: false,
        questions: [],
      },
      schedule: {
        name: 'Working hours',
        timeZone: 'UTC',
        weekly: [],
        overrides: [],
      },
    };
    const saved = {
      profileId: 'profile-1',
      eventTypeId: 'link-1',
      revision: 4,
      draft,
    };
    let reads = 0;
    const { macro, requests } = macroAnswering((request) => {
      if (request.method === 'PUT') return Response.json(saved);
      reads++;
      if (reads === 1)
        return Response.json({ links: [{ ...saved, revision: 3 }] });
      return Response.json({ message: 'link unavailable' }, { status: 404 });
    });

    const result = await runOperation({
      operation: operation('BookingLink.edit'),
      input: {
        bookingLink: { id: 'link-1' },
        draft,
        options: { userConfirmation: 'Yes, save it.' },
      },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'PUT',
      'GET',
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      result: {
        id: 'link-1',
        detail: saved,
        url: 'https://app.test/app/book/profile-1/intro',
      },
    });

    const failedRead = await runOperation({
      operation: operation('BookingLink.webUrl'),
      input: { bookingLink: { id: 'link-1' } },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });
    expect(failedRead.isError).toBe(true);
    expect(failedRead.structuredContent).toMatchObject({
      error: { code: 'not_found' },
    });
  });

  test('a Macro URL addresses the handle its last path segment names', async () => {
    const { macro, requests } = macroAnswering(() =>
      Response.json({ permission: 'edit' })
    );

    const result = await runOperation({
      operation: operation('Document.permission'),
      input: { document: 'https://macro.com/app/md/0192f4c8-doc' },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(result.isError).toBeUndefined();
    expect(requests).toEqual([
      {
        method: 'GET',
        url: 'https://storage.test/entity/document/0192f4c8-doc/permissions',
        body: undefined,
      },
    ]);
    expect(result.structuredContent).toEqual({
      result: { permission: 'edit' },
      url: 'https://app.test/app/md/0192f4c8-doc',
    });
  });

  test('an input the schema rejects never reaches the API', async () => {
    const { macro, requests } = macroAnswering(() => Response.json({}));

    const result = await runOperation({
      operation: operation('Document.permission'),
      input: { document: 'doc-1', surprise: true },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(requests).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: 'invalid',
        message: 'input: Unrecognized key: "surprise"',
      },
    });
  });

  test('a 404 is not_found and a 500 hides the server body', async () => {
    const notFound = macroAnswering(() =>
      Response.json({ message: 'document is gone' }, { status: 404 })
    );
    const missing = await runOperation({
      operation: operation('Document.permission'),
      input: { document: 'doc-1' },
      macro: notFound.macro,
      catalog,
      classes: handleClasses,
      validators,
    });
    expect(missing.structuredContent).toEqual({
      error: {
        code: 'not_found',
        message: 'Macro API error 404: document is gone',
      },
    });

    const failing = macroAnswering(() =>
      Response.json({ message: 'pool exhausted at db-3' }, { status: 500 })
    );
    const failed = await runOperation({
      operation: operation('Document.permission'),
      input: { document: 'doc-1' },
      macro: failing.macro,
      catalog,
      classes: handleClasses,
      validators,
    });
    expect(failed.structuredContent).toEqual({
      error: { code: 'internal', message: 'Macro API error 500' },
    });
  });

  test('an iterating operation stops at maxItems without fetching further pages', async () => {
    const { macro, requests } = macroAnswering(() =>
      Response.json({
        items: [
          { id: 'channel-1', name: 'General', channel_type: 'public' },
          { id: 'channel-2', name: 'Random', channel_type: 'public' },
          { id: 'channel-3', name: 'Design', channel_type: 'public' },
        ],
        next_cursor: 'cursor-2',
      })
    );

    const result = await runOperation({
      operation: operation('channels.list'),
      input: { maxItems: 2 },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(requests).toHaveLength(1);
    expect(result.content).toEqual([
      { type: 'text', text: 'channels.list: 2 items' },
    ]);
    expect(result.structuredContent).toEqual({
      result: [
        { id: 'channel-1', url: 'https://app.test/app/channel/channel-1' },
        { id: 'channel-2', url: 'https://app.test/app/channel/channel-2' },
      ],
    });
  });

  test('an abstract handle parameter takes any subclass by kind and id', async () => {
    const { macro, requests } = macroAnswering(() =>
      Response.json({ entityId: 'project-1', entityType: 'project' })
    );

    const result = await runOperation({
      operation: operation('favorites.add'),
      input: { entity: { kind: 'Project', id: 'project-1' } },
      macro,
      catalog,
      classes: handleClasses,
      validators,
    });

    expect(result.isError).toBeUndefined();
    expect(
      requests.map((request) => [
        request.method,
        JSON.parse(request.body ?? ''),
      ])
    ).toEqual([['POST', { entityId: 'project-1', entityType: 'project' }]]);
  });
});
