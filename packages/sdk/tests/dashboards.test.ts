import { afterEach, describe, expect, test } from 'bun:test';
import type { Dashboard as DashboardRecord } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const DASHBOARD = '0198a4cc-e138-7670-a308-a6b766602740';
const AGENT = 'macro|agent@example.com';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const VIEW = {
  title: 'Ops',
  widgets: [{ type: 'md', id: 'intro', markdown: 'Hello' }],
};

function record(overrides: Partial<DashboardRecord> = {}): DashboardRecord {
  return {
    id: DASHBOARD,
    ownerId: AGENT,
    title: 'Ops',
    version: 1,
    view: VIEW,
    accessLevel: 'owner',
    createdAt: '2026-11-13T12:00:00Z',
    updatedAt: '2026-11-13T12:00:00Z',
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
    hosts: {
      storage: 'https://storage.example.test',
      auth: 'https://auth.example.test',
    },
  });
  return { macro, requests };
}

describe('dashboards', () => {
  test('creates a dashboard and keeps its record', async () => {
    const { macro, requests } = serve(Response.json(record()));

    const dashboard = await macro.dashboards.create(VIEW);

    expect(dashboard.id).toBe(DASHBOARD);
    expect(await dashboard.version()).toBe(1);
    expect((await dashboard.owner()).id).toBe(AGENT);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(new URL(requests[0].url).pathname).toBe('/dashboards');
    expect(await requests[0].json()).toEqual({ view: VIEW });
    expect(dashboard.webUrl()).toEndWith(`/app/dashboard/${DASHBOARD}`);
  });

  test('patches one pane against the version it saw', async () => {
    const widget = { type: 'md', id: 'intro', markdown: 'Patched' };
    const { macro, requests } = serve(
      Response.json(
        record({ version: 2, view: { ...VIEW, widgets: [widget] } }),
      ),
    );
    const dashboard = macro.dashboards.byId(DASHBOARD);

    await dashboard.patch('intro', widget, { expectedVersion: 1 });

    expect(await dashboard.version()).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('PATCH');
    expect(new URL(requests[0].url).pathname).toBe(
      `/dashboards/${DASHBOARD}/panes/intro`,
    );
    expect(await requests[0].json()).toEqual({ widget, expectedVersion: 1 });
  });

  test('a stale save surfaces the conflict', async () => {
    const { macro } = serve(
      Response.json(
        { message: 'the dashboard changed since version 1' },
        { status: 409 },
      ),
    );

    await expect(
      macro.dashboards.byId(DASHBOARD).update(VIEW, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('reverts to an earlier version and lists the history with its authors', async () => {
    const { macro, requests } = serve(
      Response.json({
        versions: [
          {
            version: 2,
            authorId: 'macro|admin@example.com',
            createdAt: '2026-11-13T13:00:00Z',
          },
          { version: 1, authorId: AGENT, createdAt: '2026-11-13T12:00:00Z' },
        ],
      }),
      Response.json(record({ version: 3 })),
    );
    const dashboard = macro.dashboards.byId(DASHBOARD);

    const history = await dashboard.versions();
    await dashboard.revert(1);

    expect(history.map((entry) => [entry.version, entry.author.id])).toEqual([
      [2, 'macro|admin@example.com'],
      [1, AGENT],
    ]);
    expect(await dashboard.version()).toBe(3);
    expect(new URL(requests[1].url).pathname).toBe(
      `/dashboards/${DASHBOARD}/versions/1/revert`,
    );
  });

  test('a user without a home dashboard has none', async () => {
    const { macro, requests } = serve(
      Response.json({ message: 'dashboard not found' }, { status: 404 }),
    );

    expect(
      await macro.dashboards.home(macro.users.byId(AGENT)),
    ).toBeUndefined();
    expect(new URL(requests[0].url).pathname).toBe(
      `/dashboards/home/${encodeURIComponent(AGENT)}`,
    );
  });

  test('sets the caller home dashboard by handle', async () => {
    const { macro, requests } = serve(new Response(null, { status: 204 }));

    await macro.me.setHomeDashboard(macro.dashboards.byId(DASHBOARD));

    expect(requests[0].method).toBe('PUT');
    expect(new URL(requests[0].url).pathname).toBe('/dashboards/home');
    expect(await requests[0].json()).toEqual({ dashboardId: DASHBOARD });
  });
});
