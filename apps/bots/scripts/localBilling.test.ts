import { expect, spyOn, test } from 'bun:test';
import { request } from 'node:http';
import { createServer } from 'vite';
import { localAuth } from './localAuth';

const team = '0193a1b2-0000-7000-8000-0000000000aa';
const outsideTeam = '0193a1b2-0000-7000-8000-0000000000bb';
const reviewer = 'macro|macrobots-reviewer@example.test';

test('Billing forwards only a signed pinned team read and discards scope changes', async () => {
  let currentTeam = team;
  let changeDuringRead = false;
  let reads = 0;
  const fetchLocal = globalThis.fetch;
  const fixtureFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const req = new Request(input);
      const url = new URL(req.url);
      expect(url.origin).toBe('http://127.0.0.1:23211');
      switch (url.pathname) {
        case '/auth/login/passwordless':
          return Response.json({});
        case '/auth/oauth/passwordless/123456':
          return Response.json({ access_token: 'synthetic-review-session' });
        case '/auth/user/me':
          return Response.json({ user_id: reviewer });
        case '/auth/team':
          return Response.json({
            team: { id: currentTeam, name: 'Macro Bots Local Review' },
            members: [
              { user_id: reviewer, team_id: currentTeam, role: 'owner' },
            ],
          });
        case '/auth/team/computers/usage':
          expect(req.method).toBe('GET');
          expect(url.search).toBe('');
          expect(req.headers.get('authorization')).toBe(
            'Bearer synthetic-review-session'
          );
          reads += 1;
          if (changeDuringRead) currentTeam = outsideTeam;
          return Response.json([]);
        default:
          throw new Error('Unexpected upstream request from Billing review');
      }
    },
    { preconnect: fetchLocal.preconnect }
  );
  const upstream = spyOn(globalThis, 'fetch').mockImplementation(fixtureFetch);

  const path = '/auth-proof';
  const server = await createServer({
    configFile: false,
    plugins: [localAuth(path, true)],
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, cors: false, ws: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Loopback server did not bind');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const route = `${origin}${path}/compute-usage`;
    expect((await fetchLocal(route)).status).toBe(401);
    const withBody = await new Promise<number | undefined>(
      (resolve, reject) => {
        request(route, { headers: { 'Content-Length': '4' } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
          .on('error', reject)
          .end('body');
      }
    );
    expect(withBody).toBe(400);
    expect((await fetchLocal(`${route}?team=${outsideTeam}`)).status).toBe(404);
    expect(
      (await fetchLocal(route, { method: 'POST', headers: { Origin: origin } }))
        .status
    ).toBe(404);
    expect((await fetchLocal(`${origin}${path}/hire-access`)).status).toBe(404);
    expect(reads).toBe(0);

    const begin = await fetchLocal(`${origin}${path}/begin`, {
      method: 'POST',
      headers: { Origin: origin },
    });
    const pending = begin.headers.get('set-cookie')?.split(';')[0];
    if (!pending) throw new Error('Missing local challenge cookie');

    const complete = await fetchLocal(`${origin}${path}/complete`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: pending,
        'Content-Type': 'text/plain',
      },
      body: '123456',
    });
    const cookie = complete.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Missing verified local session cookie');

    const signed = { headers: { Cookie: cookie } };
    const authorized = await fetchLocal(route, signed);
    expect(await authorized.json()).toEqual({
      status: 'ready',
      teamId: team,
      value: [],
    });
    expect(authorized.headers.get('cache-control')).toBe('no-store');
    expect(reads).toBe(1);

    currentTeam = outsideTeam;
    const denied = await fetchLocal(route, signed);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ status: 'denied' });
    expect(reads).toBe(1);

    currentTeam = team;
    changeDuringRead = true;
    const stale = await fetchLocal(route, signed);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({ status: 'denied' });
    expect(reads).toBe(2);
  } finally {
    upstream.mockRestore();
    await server.close();
  }
});
