import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { anthropicRelay } from './anthropic-relay.ts';

test('query capabilities reject absent, revoked and other-query tokens and restrict upstream routes', async (t) => {
  const calls: string[] = [];
  const upstream = createServer((req, res) => {
    calls.push(req.url ?? '');
    assert.equal(req.headers.authorization, 'Bearer same-enrollment-key');
    assert.equal(req.headers['x-api-key'], undefined);
    req.resume();
    res.end('accepted');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address();
  assert(address && typeof address !== 'string');
  const relay = await anthropicRelay(
    `http://127.0.0.1:${address.port}/anthropic`,
    'same-enrollment-key'
  );
  t.after(() => relay.close());
  const first = relay.access(new AbortController().signal);
  const second = relay.access(new AbortController().signal);
  assert.notEqual(first.token, second.token);
  assert.equal(new URL(first.baseUrl).hostname, '127.0.0.1');
  assert.equal(
    (await fetch(`${first.baseUrl}/v1/messages`, { method: 'POST' })).status,
    401
  );
  assert.equal(
    (
      await fetch(`${first.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${second.token}` },
      })
    ).status,
    401
  );
  for (const route of ['/v1/messages', '/v1/messages/count_tokens?beta=true']) {
    const response = await fetch(first.baseUrl + route, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${first.token}`,
        'x-api-key': 'do-not-forward',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'accepted');
  }
  for (const route of [
    '/v1/models',
    '/v1/messages/../../admin',
    '/v1/messages?upstream=https://example.com',
  ])
    assert.equal(
      (
        await fetch(first.baseUrl + route, {
          method: 'POST',
          headers: { authorization: `Bearer ${first.token}` },
        })
      ).status,
      401
    );
  assert.equal(
    (
      await fetch(`${first.baseUrl}/v1/messages`, {
        headers: { authorization: `Bearer ${first.token}` },
      })
    ).status,
    405
  );
  first.revoke();
  assert.equal(
    (
      await fetch(`${first.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${first.token}` },
      })
    ).status,
    401
  );
  assert.deepEqual(calls, [
    '/anthropic/v1/messages',
    '/anthropic/v1/messages/count_tokens?beta=true',
  ]);
});

test('SSE bytes and usage events arrive before upstream completes, without buffering or transformation', async (t) => {
  const finish = Promise.withResolvers<void>();
  const requestBody = Promise.withResolvers<string>();
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requestBody.resolve(body);
    res.writeHead(201, {
      'content-type': 'text/event-stream',
      'request-id': 'fixture-request',
    });
    res.write('event: message_start\ndata: {"usage":{"input_tokens":12}}\n\n');
    await finish.promise;
    res.end('event: message_delta\ndata: {"usage":{"output_tokens":7}}\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => {
    finish.resolve();
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address();
  assert(address && typeof address !== 'string');
  const relay = await anthropicRelay(
    `http://127.0.0.1:${address.port}`,
    'upstream-key'
  );
  t.after(() => relay.close());
  const lease = relay.access(new AbortController().signal);
  const response = await fetch(`${lease.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${lease.token}` },
    body: '{"stream":true}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('request-id'), 'fixture-request');
  assert.equal(await requestBody.promise, '{"stream":true}');
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(
    new TextDecoder().decode(first.value),
    'event: message_start\ndata: {"usage":{"input_tokens":12}}\n\n'
  );
  finish.resolve();
  let rest = '';
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    rest += new TextDecoder().decode(part.value);
  }
  assert.equal(
    rest,
    'event: message_delta\ndata: {"usage":{"output_tokens":7}}\n\n'
  );
  lease.revoke();
});

test('query abort revokes its token and closes an in-flight upstream stream', async (t) => {
  const closed = Promise.withResolvers<void>();
  const upstream = createServer((req, res) => {
    req.resume();
    res.on('close', () => closed.resolve());
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: started\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address();
  assert(address && typeof address !== 'string');
  const relay = await anthropicRelay(
    `http://127.0.0.1:${address.port}`,
    'upstream-key'
  );
  t.after(() => relay.close());
  const stop = new AbortController();
  const lease = relay.access(stop.signal);
  const response = await fetch(`${lease.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${lease.token}` },
  });
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  stop.abort();
  await closed.promise;
  await assert.rejects(reader.read());
  assert.equal(
    (
      await fetch(`${lease.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${lease.token}` },
      })
    ).status,
    401
  );
  assert.throws(() => relay.access(stop.signal), /not active/);
});

test('a child disconnect cancels upstream', async (t) => {
  const closed = Promise.withResolvers<void>();
  const upstream = createServer((req, res) => {
    req.resume();
    res.on('close', () => closed.resolve());
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: started\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address();
  assert(address && typeof address !== 'string');
  const relay = await anthropicRelay(
    `http://127.0.0.1:${address.port}`,
    'upstream-key'
  );
  t.after(() => relay.close());
  const lease = relay.access(new AbortController().signal);
  const response = await fetch(`${lease.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${lease.token}` },
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await closed.promise;
});
