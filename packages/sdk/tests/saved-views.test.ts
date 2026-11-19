import { afterEach, describe, expect, test } from 'bun:test';
import type { SavedViewDefinition } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const VIEW = '0198a4cc-e138-7670-a308-a6b766602730';
const OTHER = '0198a4cc-e138-7670-a308-a6b766602731';
const TEAM = '0198a4cc-e138-7670-a308-a6b766602732';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function record(
  overrides: Partial<SavedViewDefinition> = {},
): SavedViewDefinition {
  return {
    id: VIEW,
    ownerId: 'macro|owner@example.com',
    name: 'Invoices',
    config: { kind: 'email', version: 1, filters: {} },
    sharedTeamId: null,
    revision: 3,
    createdAt: '2026-11-04T12:00:00Z',
    updatedAt: '2026-11-04T12:00:00Z',
    ...overrides,
  };
}

/** Answers each request with the next scripted response and keeps the requests. */
function serve(...responses: Response[]) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    const response = responses.shift();
    if (!response) throw new Error(`unexpected request ${request.url}`);
    return response;
  }) as typeof fetch;
  const macro = new Macro({
    token: 'user-token',
    hosts: { storage: 'https://storage.example.test' },
  });
  return { macro, requests };
}

describe('saved views', () => {
  test('creates a view shared with a team and keeps its record', async () => {
    const { macro, requests } = serve(
      Response.json(record({ sharedTeamId: TEAM }), { status: 201 }),
    );

    const view = await macro.savedViews.create({
      name: 'Invoices',
      config: { kind: 'email', version: 1, filters: {} },
      team: macro.teams.byId(TEAM),
    });

    expect(view.id).toBe(VIEW);
    expect(await view.kind()).toBe('email');
    expect((await view.team())?.id).toBe(TEAM);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(new URL(requests[0].url).pathname).toBe('/saved_views/definitions');
    expect(await requests[0].json()).toEqual({
      name: 'Invoices',
      config: { kind: 'email', version: 1, filters: {} },
      sharedTeamId: TEAM,
    });
  });

  test('edits against the revision it saw and chains onto the next one', async () => {
    const { macro, requests } = serve(
      Response.json(record()),
      Response.json(record({ name: 'Bills', revision: 4 })),
      Response.json(record({ name: 'Bills', revision: 4 })),
      Response.json(record({ name: 'Bills', revision: 5, sharedTeamId: TEAM })),
      Response.json(record({ name: 'Bills', revision: 5, sharedTeamId: TEAM })),
      Response.json(record({ name: 'Bills', revision: 6 })),
      Response.json(record({ name: 'Bills', revision: 6 })),
    );
    const view = macro.savedViews.byId(VIEW);

    await view.edit({ name: 'Bills' });
    await view.edit({ team: macro.teams.byId(TEAM) });
    await view.edit({ team: null });

    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'PATCH',
      'GET',
      'PATCH',
      'GET',
      'PATCH',
    ]);
    expect(await requests[1].json()).toEqual({
      expectedRevision: 3,
      name: 'Bills',
    });
    expect(await requests[3].json()).toEqual({
      expectedRevision: 4,
      sharing: { teamId: TEAM },
    });
    expect(await requests[5].json()).toEqual({
      expectedRevision: 5,
      sharing: { teamId: null },
    });
    expect(await view.revision()).toBe(6);
  });

  test('a stale edit fails with a conflict instead of overwriting', async () => {
    const { macro } = serve(
      Response.json(record()),
      Response.json(
        { message: 'saved view revision conflict' },
        { status: 409 },
      ),
    );

    await expect(
      macro.savedViews.byId(VIEW).edit({ name: 'Bills' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('removes only the revision it saw', async () => {
    const { macro, requests } = serve(
      Response.json(record({ revision: 7 })),
      new Response(null, { status: 204 }),
    );

    await macro.savedViews.byId(VIEW).remove();

    const url = new URL(requests[1].url);
    expect(requests[1].method).toBe('DELETE');
    expect(url.pathname).toBe(`/saved_views/definitions/${VIEW}`);
    expect(url.searchParams.get('expectedRevision')).toBe('7');
  });

  test('lists one kind across pages', async () => {
    const { macro, requests } = serve(
      Response.json({ views: [record()], nextCursor: 'page-2' }),
      Response.json({ views: [record({ id: OTHER })], nextCursor: null }),
    );

    const ids: string[] = [];
    for await (const view of macro.savedViews.list({ kind: 'email' })) {
      ids.push(view.id);
    }

    expect(ids).toEqual([VIEW, OTHER]);
    const [first, second] = requests.map((request) => new URL(request.url));
    expect(first.searchParams.get('kind')).toBe('email');
    expect(first.searchParams.get('after')).toBeNull();
    expect(second.searchParams.get('after')).toBe('page-2');
  });

  test('reorders one kind and returns the views in their new order', async () => {
    const { macro, requests } = serve(
      Response.json([record({ id: OTHER }), record()]),
    );

    const views = await macro.savedViews.reorder('email', [
      macro.savedViews.byId(OTHER),
      macro.savedViews.byId(VIEW),
    ]);

    expect(views.map((view) => view.id)).toEqual([OTHER, VIEW]);
    expect(requests[0].method).toBe('PUT');
    expect(new URL(requests[0].url).pathname).toBe(
      '/saved_views/definitions/order',
    );
    expect(await requests[0].json()).toEqual({
      kind: 'email',
      ids: [OTHER, VIEW],
    });
  });

  test('creates appearance atomically and replaces it without changing the filter revision', async () => {
    const appearance = {
      icon: { kind: 'emoji' as const, value: '📚' },
      color: 'blue' as const,
    };
    const { macro, requests } = serve(
      Response.json(record({ appearance }), { status: 201 }),
      Response.json(record({ appearance: {} })),
      Response.json(record({ appearance: {} })),
      Response.json(record({ name: 'Bills', appearance: {}, revision: 4 })),
    );
    const view = await macro.savedViews.create({
      name: 'Invoices',
      config: { kind: 'email', version: 1, filters: {} },
      appearance,
    });
    expect(await view.appearance()).toEqual(appearance);
    expect((await requests[0].json()).appearance).toEqual(appearance);
    expect(await view.setAppearance({})).toEqual({});
    expect(requests[1].method).toBe('PUT');
    expect(new URL(requests[1].url).pathname).toBe(
      `/saved_views/definitions/${VIEW}/appearance`,
    );
    expect(await requests[1].json()).toEqual({});
    expect(await view.revision()).toBe(3);
    await view.edit({ name: 'Bills' });
    expect((await requests[3].json()).expectedRevision).toBe(3);
  });

  test('retains the loaded appearance when the owner-only write is refused', async () => {
    const appearance = { icon: { kind: 'emoji' as const, value: '📚' } };
    const { macro } = serve(
      Response.json(record({ appearance })),
      Response.json({ message: 'not found' }, { status: 404 }),
    );
    const view = macro.savedViews.byId(VIEW);
    expect(await view.appearance()).toEqual(appearance);
    await expect(view.setAppearance({})).rejects.toMatchObject({ status: 404 });
    expect(await view.appearance()).toEqual(appearance);
    expect(await view.revision()).toBe(3);
  });

  test('reloads the current revision after an older appearance response arrives late', async () => {
    const appearanceResponse = Promise.withResolvers<Response>();
    const appearanceStarted = Promise.withResolvers<void>();
    const revisions: number[] = [];
    let latest = record();
    globalThis.fetch = Object.assign(
      async (...[input, init]: Parameters<typeof fetch>) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        if (request.method === 'PUT') {
          latest = { ...latest, appearance: {} };
          appearanceStarted.resolve();
          return appearanceResponse.promise;
        }
        if (request.method === 'PATCH') {
          const body: { expectedRevision: number; name: string } =
            await request.json();
          revisions.push(body.expectedRevision);
          if (body.expectedRevision !== latest.revision)
            return Response.json(
              { message: 'revision conflict' },
              { status: 409 },
            );
          latest = {
            ...latest,
            name: body.name,
            revision: latest.revision + 1,
          };
        }
        return Response.json(latest);
      },
      { preconnect: originalFetch.preconnect },
    );
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const view = macro.savedViews.byId(VIEW);
    await view.name();
    const changingAppearance = view.setAppearance({});
    await appearanceStarted.promise;
    await view.edit({ name: 'Bills' });
    appearanceResponse.resolve(Response.json(record({ appearance: {} })));
    await changingAppearance;
    await view.edit({ name: 'Latest bills' });
    expect(revisions).toEqual([3, 4]);
    expect(await view.name()).toBe('Latest bills');
    expect(await view.appearance()).toEqual({});
  });
});
