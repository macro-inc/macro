import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const SESSION = '0198a4cc-e138-7670-a308-a6b766602700';
const EXECUTION = '0198a4cc-e138-7670-a308-a6b766602788';
const DOC = '0198a4cc-e138-7670-a308-a6b766602799';

function macroAnswering(outcome: unknown) {
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push({ url: request.url, body: await request.clone().json() });
    return Response.json(outcome);
  }) as typeof fetch;
  const macro = new Macro({
    token: 'test-token',
    hosts: { 'agent-harness': 'https://agent.example.test' },
    webAppUrl: 'https://macro.com',
  });
  const execution = macro.agentSessions
    .byId(SESSION)
    .codeExecutions.byId(EXECUTION);

  return { macro, execution, requests };
}

describe('macro.ui', () => {
  test('opens an item beside the agent, sending its app path only', async () => {
    const { macro, execution, requests } = macroAnswering({
      status: 'sent',
      commandId: '0198a4cc-e138-7670-a308-a6b7666027aa',
    });

    const result = await macro.ui.open(execution, macro.documents.byId(DOC));

    expect(result).toEqual({
      status: 'sent',
      url: `https://macro.com/app/md/${DOC}`,
    });
    expect(requests).toEqual([
      {
        url: `https://agent.example.test/agent-sessions/${SESSION}/ui-commands`,
        body: { executionId: EXECUTION, path: `/md/${DOC}` },
      },
    ]);
  });

  test('answers no_client and declined with the link to reply with', async () => {
    const link = 'https://macro.com/app/tasks?s0.tasks.tab=mine';

    const none = macroAnswering({ status: 'no_client' });
    const noClient = await none.macro.ui.open(
      none.execution,
      none.macro.ui.link(link)
    );
    const refused = macroAnswering({
      status: 'declined',
      reason: 'rate_limited',
    });
    const declined = await refused.macro.ui.open(
      refused.execution,
      refused.macro.ui.link(link),
      { placement: 'new' }
    );

    expect(noClient).toEqual({ status: 'no_client', url: link });
    expect(declined).toEqual({
      status: 'declined',
      reason: 'rate_limited',
      url: link,
    });
    expect(refused.requests[0]?.body).toEqual({
      executionId: EXECUTION,
      path: '/tasks?s0.tasks.tab=mine',
      placement: 'new',
    });
  });

  test('link refuses anything but a Macro app link', () => {
    const { macro } = macroAnswering({ status: 'no_client' });

    for (const url of [
      'https://evil.example.com/app/md/x',
      'https://macro.com.evil.example.com/app/md/x',
      'http://macro.com/app/md/x',
      'https://macro.com/blog',
      'https://macro.com/app/md/x#token',
      'javascript:alert(1)',
      '/app/md/x',
    ]) {
      expect(() => macro.ui.link(url), url).toThrow('Not a Macro app link');
    }
    expect(macro.ui.link('https://www.macro.com/app/channels/c').path).toBe(
      '/channels/c'
    );
  });
});
