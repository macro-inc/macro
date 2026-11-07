import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkHosts } from './dry-run.ts';
import { MacroHttp } from './macro.ts';

test('scoped HTTP adapters do not serialize their credential into agent code', () => {
  const http = new MacroHttp(
    checkHosts,
    'private-agent-key',
    async () => new Response()
  );
  assert.equal(JSON.stringify(http).includes('private-agent-key'), false);
});
