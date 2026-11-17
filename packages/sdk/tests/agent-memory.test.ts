import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const AGENT_ID = '0198a4cc-e138-7670-a308-a6b766602710';

type Call = { method: string; url: string; body: unknown };

/** Answer each request with the next response, recording what was sent. */
function serve(...responses: { status: number; body: unknown }[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const text = await request.text();
    calls.push({
      method: request.method,
      url: request.url,
      body: text ? JSON.parse(text) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${request.url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function macro(): Macro {
  return new Macro({
    auth: { type: 'user', token: 'user-key' },
    hosts: { storage: 'https://storage.example.test' },
  });
}

describe('agent memory', () => {
  test('memory reads the content and revision in SDK form', async () => {
    const calls = serve({
      status: 200,
      body: { content: '', revision: 0, updated_at: null },
    });

    expect(await macro().agents.byId(AGENT_ID).memory()).toEqual({
      content: '',
      revision: 0,
      updatedAt: undefined,
    });
    expect(calls).toEqual([
      {
        method: 'GET',
        url: `https://storage.example.test/agents/${AGENT_ID}/memory`,
        body: undefined,
      },
    ]);
  });

  test('updateMemory replaces it against the revision it was read at', async () => {
    const calls = serve({
      status: 200,
      body: {
        content: '- Ship on Thursdays.',
        revision: 1,
        updated_at: '2026-11-06T12:00:00Z',
      },
    });

    expect(
      await macro()
        .agents.byId(AGENT_ID)
        .updateMemory('- Ship on Thursdays.', 0),
    ).toEqual({
      content: '- Ship on Thursdays.',
      revision: 1,
      updatedAt: '2026-11-06T12:00:00Z',
    });
    expect(calls).toEqual([
      {
        method: 'PUT',
        url: `https://storage.example.test/agents/${AGENT_ID}/memory`,
        body: { content: '- Ship on Thursdays.', revision: 0 },
      },
    ]);
  });

  test('a stale revision fails without a write', async () => {
    serve({
      status: 409,
      body: { message: 'the agent memory changed since it was read' },
    });

    await expect(
      macro().agents.byId(AGENT_ID).updateMemory('- Overwritten.', 0),
    ).rejects.toBeInstanceOf(MacroApiError);
  });
});
