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
      Response.json(record({ name: 'Bills', revision: 5, sharedTeamId: TEAM })),
      Response.json(record({ name: 'Bills', revision: 6 })),
    );
    const view = macro.savedViews.byId(VIEW);

    await view.edit({ name: 'Bills' });
    await view.edit({ team: macro.teams.byId(TEAM) });
    await view.edit({ team: null });

    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'PATCH',
      'PATCH',
      'PATCH',
    ]);
    expect(await requests[1].json()).toEqual({
      expectedRevision: 3,
      name: 'Bills',
    });
    expect(await requests[2].json()).toEqual({
      expectedRevision: 4,
      sharing: { teamId: TEAM },
    });
    expect(await requests[3].json()).toEqual({
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
});
