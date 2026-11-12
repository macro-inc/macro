import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroError } from '../src/utils';

const TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602700';
const OTHER_TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602701';
const MEMBER_ID = 'macro|member@example.com';
const MEMBER_PATH = encodeURIComponent(MEMBER_ID);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Route = (request: Request) => Response | Promise<Response>;

function serve(routes: Record<string, Route>): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      const key = `${request.method} ${new URL(request.url).pathname}`;
      const route = routes[key];
      if (!route) throw new Error(`unexpected request ${key}`);
      return route(request);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

function macro(): Macro {
  return new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { auth: 'https://auth.test' },
    webAppUrl: 'https://app.example.test',
  });
}

const currentTeam =
  (id = TEAM_ID) =>
  () =>
    Response.json({
      team: {
        id,
        name: 'Acme',
        slug: 'acme',
        owner_id: 'macro|owner@example.com',
      },
      members: [],
    });

describe('Team enterprise administration', () => {
  test('disables and re-enables a member on the current team', async () => {
    const report = {
      harness_revoke_gap: true,
      mail_suspend_gap: true,
      server_records_revoked: 2,
    };
    const requests = serve({
      'GET /team': currentTeam(),
      [`POST /team/members/${MEMBER_PATH}/disable`]: () =>
        Response.json(report),
      [`POST /team/members/${MEMBER_PATH}/enable`]: () =>
        new Response(null, { status: 204 }),
    });
    const client = macro();
    const team = client.teams.byId(TEAM_ID);
    const member = client.users.byId(MEMBER_ID);

    await expect(team.disableMember(member)).resolves.toEqual(report);
    await expect(team.enableMember(member)).resolves.toBeUndefined();
    expect(
      requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual([
      'GET /team',
      `POST /team/members/${MEMBER_PATH}/disable`,
      'GET /team',
      `POST /team/members/${MEMBER_PATH}/enable`,
    ]);
  });

  test('replaces and clears the current team runtime allowlist', async () => {
    const requests = serve({
      'GET /team': currentTeam(),
      'PUT /team/runtime-presets': () =>
        Response.json({ preset_ids: ['opencode', 'omp'] }),
      'DELETE /team/runtime-presets': () => new Response(null, { status: 204 }),
    });
    const team = macro().teams.byId(TEAM_ID);

    await expect(team.setRuntimePresets(['opencode', 'omp'])).resolves.toEqual([
      'opencode',
      'omp',
    ]);
    await expect(team.clearRuntimePresets()).resolves.toBeUndefined();
    const put = requests.find((request) => request.method === 'PUT');
    expect(await put?.json()).toEqual({ preset_ids: ['opencode', 'omp'] });
    expect(
      requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual([
      'GET /team',
      'PUT /team/runtime-presets',
      'GET /team',
      'DELETE /team/runtime-presets',
    ]);
  });

  test('refuses to mutate a team other than the caller’s current team', async () => {
    const requests = serve({ 'GET /team': currentTeam(OTHER_TEAM_ID) });

    await expect(
      macro().teams.byId(TEAM_ID).setRuntimePresets(['omp']),
    ).rejects.toBeInstanceOf(MacroError);
    expect(
      requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual(['GET /team']);
  });
});
