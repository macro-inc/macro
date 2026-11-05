import { assertEquals, assertRejects } from '@std/assert';
import { gatewayHosts } from './config.ts';
import { MacroHttp, MacroHttpError } from './macro.ts';

Deno.test('a secret is read from the auth service with the agent key', async () => {
  const requests: { url: string; key: string | null }[] = [];
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

  assertEquals(value, 'ghp_secret');
  assertEquals(requests, [
    {
      url: 'https://gateway.example/auth/team_agents/me/secrets/github%20token',
      key: 'mak_agent',
    },
  ]);
});

Deno.test('a failed call names what it was doing and the status', async () => {
  const http = new MacroHttp(
    gatewayHosts('https://gateway.example'),
    'mak_agent',
    async () => new Response('no such secret', { status: 404 })
  );

  await assertRejects(
    () => http.secret('missing'),
    MacroHttpError,
    'could not read a secret: HTTP 404 no such secret'
  );
});
