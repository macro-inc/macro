import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroApiError, MacroError, MacroNotFoundError } from '../src/utils';

const TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602700';
const OTHER_TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602701';
const INVITE_ID = '0198a4cc-e138-7670-a308-a6b766602702';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Route = (request: Request) => Response | Promise<Response>;

/** Serve `routes` by `METHOD /path`, recording every request. */
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

const currentTeam = () =>
  Response.json({
    team: {
      id: TEAM_ID,
      name: 'Acme',
      slug: 'acme',
      owner_id: 'macro|owner@example.com',
    },
    members: [],
  });

const invite = {
  id: INVITE_ID,
  email: 'new.person@example.com',
  team_id: TEAM_ID,
  team_role: 'member',
  invited_by: 'macro|owner@example.com',
  created_at: '2026-01-01T00:00:00Z',
  last_sent_at: '2026-01-02T00:00:00Z',
};

describe('Team.invite', () => {
  test('invites trimmed addresses to the current team', async () => {
    const requests = serve({
      'GET /team': currentTeam,
      'POST /team/invite': () => new Response(null, { status: 201 }),
    });
    const sent = await macro()
      .teams.byId(TEAM_ID)
      .invite([' first@example.com ', '', 'second@example.com']);
    expect(sent).toBe(true);
    const post = requests.find((request) => request.method === 'POST');
    expect(await post?.json()).toEqual({
      invites: [
        { email: 'first@example.com' },
        { email: 'second@example.com' },
      ],
    });
    expect(post?.headers.get('x-macro-user-api-key')).toBe('mak_test');
  });

  test('sends a repeated address once, whatever its letter case', async () => {
    const requests = serve({
      'GET /team': currentTeam,
      'POST /team/invite': () => new Response(null, { status: 201 }),
    });
    await macro()
      .teams.byId(TEAM_ID)
      .invite([
        'first@example.com',
        'First@Example.com ',
        'second@example.com',
        'first@example.com',
      ]);
    const post = requests.find((request) => request.method === 'POST');
    expect(await post?.json()).toEqual({
      invites: [
        { email: 'first@example.com' },
        { email: 'second@example.com' },
      ],
    });
  });

  test('accepts a single address', async () => {
    const requests = serve({
      'GET /team': currentTeam,
      'POST /team/invite': () => new Response(null, { status: 201 }),
    });
    expect(
      await (await macro().teams.current()).invite('solo@example.com'),
    ).toBe(true);
    const post = requests.find((request) => request.method === 'POST');
    expect(await post?.json()).toEqual({
      invites: [{ email: 'solo@example.com' }],
    });
  });

  test('reports false when every address was already a member or invited', async () => {
    serve({
      'GET /team': currentTeam,
      'POST /team/invite': () => new Response(null, { status: 304 }),
    });
    expect(
      await macro().teams.byId(TEAM_ID).invite('existing@example.com'),
    ).toBe(false);
  });

  test('refuses a team other than the current one before inviting', async () => {
    const requests = serve({ 'GET /team': currentTeam });
    await expect(
      macro().teams.byId(OTHER_TEAM_ID).invite('someone@example.com'),
    ).rejects.toThrow('invites are only available for the current team');
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  test('refuses an empty list without calling the API', async () => {
    const requests = serve({});
    await expect(
      macro().teams.byId(TEAM_ID).invite(['  ', '']),
    ).rejects.toBeInstanceOf(MacroError);
    expect(requests).toHaveLength(0);
  });

  test('surfaces the server refusal', async () => {
    serve({
      'GET /team': currentTeam,
      'POST /team/invite': () =>
        Response.json(
          { message: 'only admins can invite to this team' },
          { status: 403 },
        ),
    });
    const error = await macro()
      .teams.byId(TEAM_ID)
      .invite('someone@example.com')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroApiError).status).toBe(403);
    expect((error as MacroApiError).message).toContain('only admins');
  });
});

describe('Team.current', () => {
  test('reports a caller without a team as not found', async () => {
    serve({ 'GET /team': () => new Response(null, { status: 204 }) });
    await expect(macro().teams.current()).rejects.toBeInstanceOf(
      MacroNotFoundError,
    );
  });
});

describe('Team.invites', () => {
  test('lists pending invites as seeded handles', async () => {
    const requests = serve({
      'GET /team': currentTeam,
      'GET /team/invites': () => Response.json({ invites: [invite] }),
    });
    const [pending, ...rest] = await macro().teams.byId(TEAM_ID).invites();
    expect(rest).toHaveLength(0);
    expect(pending?.id).toBe(INVITE_ID);
    expect(await pending?.email()).toBe('new.person@example.com');
    expect(await pending?.role()).toBe('member');
    expect(await pending?.lastSentAt()).toBe('2026-01-02T00:00:00Z');
    expect((await pending?.invitedBy())?.id).toBe('macro|owner@example.com');
    // Seeded from the listing: reading fields fetched nothing more.
    expect(requests).toHaveLength(2);
  });

  test('revokes an invite, after which it no longer resolves', async () => {
    let revoked = false;
    const requests = serve({
      'GET /team': currentTeam,
      'GET /team/invites': () =>
        Response.json({ invites: revoked ? [] : [invite] }),
      [`DELETE /team/invite/${INVITE_ID}`]: () => {
        revoked = true;
        return new Response(null, { status: 200 });
      },
    });
    const [pending] = await macro().teams.byId(TEAM_ID).invites();
    await pending?.revoke();
    expect(
      requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual([
      'GET /team',
      'GET /team/invites',
      `DELETE /team/invite/${INVITE_ID}`,
    ]);
    await expect(pending?.email()).rejects.toBeInstanceOf(MacroNotFoundError);
  });
});

describe('macro.referrals', () => {
  test('builds the referral signup link from the caller code', async () => {
    serve({ 'GET /referral/code': () => Response.json('CODE+42') });
    expect(await macro().referrals.link()).toEqual({
      code: 'CODE+42',
      url: 'https://app.example.test/app/signup?referral_code=CODE%2B42',
    });
  });

  test('emails a referral invite to one trimmed address', async () => {
    const requests = serve({
      'POST /referral/send': () => new Response(null, { status: 204 }),
    });
    await macro().referrals.invite(' friend@example.com ');
    expect(await requests[0]?.json()).toEqual({
      recipient: 'friend@example.com',
    });
  });

  test('refuses an empty address and surfaces rate limiting', async () => {
    serve({
      'POST /referral/send': () =>
        Response.json({ message: 'rate limit exceeded' }, { status: 429 }),
    });
    await expect(macro().referrals.invite('   ')).rejects.toBeInstanceOf(
      MacroError,
    );
    const error = await macro()
      .referrals.invite('friend@example.com')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroApiError).status).toBe(429);
  });
});
