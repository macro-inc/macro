// The client against the stub: the contract's headers, paths, and refusals, as codes.
import { expect, test } from 'bun:test';
import { relayHandler } from '../../../context/relay.ts';
import { mintWakeId } from '../attribution.ts';
import { vault } from '../vault.ts';
import { agentKey, origin, rig, teamId } from './rig.ts';
import { stubVault } from './stub.ts';

const login = {
  type: 'login' as const,
  username: 'ada',
  password: 'correct-horse-battery',
};

test('every call carries the key and the wake; only writes carry the passwords header', async () => {
  const { client, stub, wake } = rig();
  const id = stub.add({ name: 'Example', kind: 'login', secret: login });
  await client.search(teamId, { query: 'ex', limit: 10 });
  await client.mine(teamId, id);
  await client.requestAccess(teamId, id, 'view');
  expect(stub.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    `GET /storage/passwords/agent/teams/${teamId}/items?q=ex&limit=10`,
    `GET /storage/passwords/agent/teams/${teamId}/items/${id}/access-requests/mine`,
    `POST /storage/passwords/agent/teams/${teamId}/items/${id}/access-requests`,
  ]);
  for (const call of stub.calls) {
    expect(call.headers['x-macro-user-api-key']).toBe(agentKey);
    expect(call.headers['x-macro-agent-session-id']).toBe(wake);
    expect(call.headers['x-macro-passwords']).toBe(
      call.method === 'GET' ? undefined : '1'
    );
  }
});

test('the refusals come back as the contract codes, in its order', async () => {
  const { client, stub, clock } = rig();
  const at = (wake: string, key = agentKey) =>
    vault({
      fetch: stub.fetch,
      endpoint: async () => ({ origin, key }),
      team: async () => teamId,
      wakeId: () => wake,
      operationId: () => crypto.randomUUID(),
      clock,
      jitter: () => 0,
    });
  const fresh = mintWakeId(clock.now(), new Uint8Array(10));
  const stale = mintWakeId(
    clock.now().subtract({ hours: 25 }),
    new Uint8Array(10)
  );
  const query = { query: '', limit: 10 };
  // The key is checked before the wake, and the wake before the flags.
  expect(await at(stale, 'wrong').search(teamId, query)).toMatchObject({
    kind: 'refused',
    code: 'unauthorized',
  });
  stub.flags.enabled = false;
  expect(await at(stale).search(teamId, query)).toMatchObject({
    code: 'invalid_session_attribution',
  });
  expect(await at(fresh).search(teamId, query)).toMatchObject({
    code: 'not_found',
  });
  stub.flags.enabled = true;
  expect(
    await client.search('22222222-2222-4222-8222-222222222222', query)
  ).toMatchObject({ code: 'invalid_agent' });
  expect(await client.mine(teamId, 'no-such-item')).toMatchObject({
    code: 'not_found',
  });
  const id = stub.add({ name: 'Example', kind: 'login', secret: login });
  expect(
    await client.disclose(teamId, id, { selector: { type: 'login_password' } })
  ).toMatchObject({ code: 'not_granted' });
});

test('a busy vault is asked again after the wait it names, a few times, and then the busy answer stands', async () => {
  const { client, stub, slept } = rig();
  stub.flags.busy = 2;
  expect(await client.search(teamId, { query: '', limit: 10 })).toMatchObject({
    kind: 'ok',
  });
  expect(slept).toHaveLength(2);
  stub.flags.busy = 10;
  expect(await client.search(teamId, { query: '', limit: 10 })).toMatchObject({
    kind: 'refused',
    code: 'vault_busy',
  });
});

test("an answer the client can't read is unexpected, and says nothing of what it held", async () => {
  const { clock } = rig();
  const sentinel = 'SENTINEL-not-a-shape-0123456789';
  const strange = vault({
    fetch: async () =>
      new Response(JSON.stringify({ value: 7, secret: sentinel }), {
        status: 200,
      }),
    endpoint: async () => ({ origin, key: agentKey }),
    team: async () => teamId,
    wakeId: () => mintWakeId(clock.now(), new Uint8Array(10)),
    operationId: () => crypto.randomUUID(),
    clock,
    jitter: () => 0,
  });
  const answer = await strange.disclose(teamId, 'x', {
    selector: { type: 'login_password' },
  });
  expect(answer).toMatchObject({ kind: 'refused', code: 'unexpected' });
  expect(JSON.stringify(answer)).not.toContain(sentinel);
  const unreachable = vault({
    fetch: async () => {
      throw new Error(`connect failed ${sentinel}`);
    },
    endpoint: async () => ({ origin, key: agentKey }),
    team: async () => teamId,
    wakeId: () => 'w',
    operationId: () => crypto.randomUUID(),
    clock,
    jitter: () => 0,
  });
  const failed = await unreachable.mine(teamId, 'x');
  expect(failed).toMatchObject({ kind: 'refused', code: 'unreachable' });
  expect(JSON.stringify(failed)).not.toContain(sentinel);
});

test("through the agent's relay a script presents only its capability, and the vault sees the agent's key", async () => {
  const { clock } = rig();
  const realKey = 'mak_real-agent-key';
  const stub = stubVault({ clock, teamId, agentKey: realKey });
  const relay = relayHandler({
    targets: { storage: 'https://gateway.example.com/dss' },
    capability: 'capability-token',
    apiKey: realKey,
    fetch: stub.fetch,
    equal: (given, expected) => given === expected,
  });
  const script = vault({
    fetch: relay,
    endpoint: async () => ({
      origin: 'http://127.0.0.1:40000/storage',
      key: 'capability-token',
    }),
    team: async () => teamId,
    wakeId: () => mintWakeId(clock.now(), new Uint8Array(10)),
    operationId: () => mintWakeId(clock.now(), new Uint8Array(10).fill(1)),
    clock,
    jitter: () => 0,
  });
  const created = await script.create(teamId, {
    name: 'Through the relay',
    kind: 'note',
    url: null,
    secret: { type: 'note', text: 'hello-0123456789' },
  });
  expect(created).toMatchObject({ kind: 'ok', status: 201 });
  expect(stub.calls[0]?.path).toBe(
    `/dss/passwords/agent/teams/${teamId}/items`
  );
  expect(stub.calls[0]?.headers['x-macro-user-api-key']).toBe(realKey);
  expect(stub.calls[0]?.headers['x-macro-passwords']).toBe('1');
  expect(stub.calls[0]?.headers['x-macro-agent-session-id']).toBeDefined();
});
