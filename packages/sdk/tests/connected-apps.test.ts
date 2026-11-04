import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('connected apps', () => {
  test('lists an execution’s apps, their tools, and calls one through the harness', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const body: unknown =
        request.method === 'POST' ? await request.clone().json() : undefined;
      requests.push({ method: request.method, url: request.url, body });
      if (request.url.endsWith('/connected-apps')) {
        return Response.json([
          { kind: 'app', key: 'slack', name: 'Slack' },
          { kind: 'custom', key: '0123456789abcdef', name: 'Internal wiki' },
        ]);
      }
      if (request.url.endsWith('/connected-apps/app/slack/tools')) {
        return Response.json([
          {
            name: 'send_message',
            description: 'Send a message to a channel',
            inputSchema: {
              type: 'object',
              properties: { channel: { type: 'string' } },
            },
          },
        ]);
      }
      return Response.json({
        isError: false,
        content: [{ type: 'text', text: 'sent' }],
        structuredContent: null,
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'test-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });
    const execution = macro.agentSessions
      .byId('0198a4cc-e138-7670-a308-a6b766602700')
      .codeExecutions.byId('0198a4cc-e138-7670-a308-a6b766602788');

    const apps = await macro.connectedApps.list(execution);
    const slack = apps.find((app) => app.name === 'Slack');
    const tools = (await slack?.tools()) ?? [];
    const result = await tools[0]?.call({ channel: 'general', text: 'hi' });

    expect(apps.map((app) => app.toJSON())).toEqual([
      { kind: 'app', key: 'slack', name: 'Slack' },
      { kind: 'custom', key: '0123456789abcdef', name: 'Internal wiki' },
    ]);
    expect(tools.map((tool) => tool.toJSON())).toEqual([
      {
        app: { kind: 'app', key: 'slack', name: 'Slack' },
        name: 'send_message',
        description: 'Send a message to a channel',
        inputSchema: {
          type: 'object',
          properties: { channel: { type: 'string' } },
        },
      },
    ]);
    expect(result).toEqual({
      isError: false,
      content: [{ type: 'text', text: 'sent' }],
      structuredContent: undefined,
    });
    const base =
      'https://agent.example.test/agent-sessions/0198a4cc-e138-7670-a308-a6b766602700/code-executions/0198a4cc-e138-7670-a308-a6b766602788/connected-apps';
    expect(requests).toEqual([
      { method: 'GET', url: base, body: undefined },
      { method: 'GET', url: `${base}/app/slack/tools`, body: undefined },
      {
        method: 'POST',
        url: `${base}/app/slack/calls`,
        body: {
          tool: 'send_message',
          arguments: { channel: 'general', text: 'hi' },
        },
      },
    ]);
  });
});
