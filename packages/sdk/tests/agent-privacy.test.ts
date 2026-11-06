import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('agent privacy uses the wire flag and omission preserves older update callers', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    bodies.push((await request.json()) as Record<string, unknown>);
    return Response.json({ bot: { id: 'agent-1' }, is_ephemeral: true });
  }) as typeof fetch;
  const macro = new Macro({
    auth: { type: 'bot', token: 'mbot_test_token', scope: 'team' },
    hosts: { storage: 'https://storage.example.test' },
  });
  const options = {
    name: 'Research',
    handle: 'research',
    instructions: 'Help research',
    harness: 'in-memory',
    channelScope: 'all' as const,
    defaultModel: 'test-model',
    isCoding: false,
  };
  const agent = macro.agents.byId('agent-1');
  await agent.update({ ...options, isEphemeral: true });
  await agent.update(options);
  await agent.update({ ...options, isEphemeral: false });
  expect(bodies[0].is_ephemeral).toBe(true);
  expect(bodies[1]).not.toHaveProperty('is_ephemeral');
  expect(bodies[2].is_ephemeral).toBe(false);
});
