import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gatewayHosts } from './config.ts';
import { MacroHttp, MacroHttpError } from './macro.ts';

test('a secret is read from the auth service with the agent key', async () => {
  const requests: {
    url: string;
    key: string | null;
  }[] = [];
  const http = new MacroHttp(
    gatewayHosts('https://gateway.example'),
    'mak_agent',
    async (url, init) => {
      requests.push({
        url,
        key: new Headers(init?.headers).get('x-macro-user-api-key'),
      });
      return Response.json({ name: 'github token', value: 'ghp_secret' });
    }
  );
  const value = await http.secret('github token');
  assert.deepEqual(value, 'ghp_secret');
  assert.deepEqual(requests, [
    {
      url: 'https://gateway.example/auth/team_agents/me/secrets/github%20token',
      key: 'mak_agent',
    },
  ]);
});
test('a failed call names what it was doing and the status', async () => {
  const http = new MacroHttp(
    gatewayHosts('https://gateway.example'),
    'mak_agent',
    async () => new Response('no such secret', { status: 404 })
  );
  await assert.rejects(
    () => http.secret('missing'),
    (error: unknown) =>
      error instanceof MacroHttpError &&
      error.message.includes('could not read a secret: HTTP 404 no such secret')
  );
});
