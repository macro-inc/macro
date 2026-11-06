import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gatewayHosts } from './config.ts';
import { MacroHttp } from './macro.ts';

test('scoped HTTP adapters do not serialize their credential into agent code', () => {
  const http = new MacroHttp(
    gatewayHosts('https://gateway.example'),
    'private-agent-key',
    async () => new Response()
  );
  assert.equal(JSON.stringify(http).includes('private-agent-key'), false);
});
