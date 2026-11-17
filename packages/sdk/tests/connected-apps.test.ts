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

  test('discovers a connector, inspects it, and adds an MCP server through the harness', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const body: unknown = await request.clone().json();
      requests.push({ url: request.url, body });
      if (request.url.endsWith('/connected-apps/servers')) {
        return Response.json({
          url: 'https://mcp.linear.app/mcp',
          serverName: 'Linear',
          alreadyConnected: false,
          authenticated: false,
          enabled: true,
          summary: 'Added Linear.',
        });
      }
      if ((body as { operation: string }).operation === 'search') {
        return Response.json({
          result: {
            operation: 'search',
            apps: [
              { app_slug: 'linear', name: 'Linear', description: 'Issues' },
            ],
            more_results: false,
          },
          connect_markup: null,
        });
      }
      return Response.json({
        result: {
          operation: 'inspect',
          app: { app_slug: 'linear', name: 'Linear', description: 'Issues' },
          connected: false,
          tools: [{ name: 'create_issue', description: 'Create an issue' }],
          tools_truncated: false,
        },
        connect_markup:
          '<m-connect-app>{"appSlug":"linear","name":"Linear"}</m-connect-app>',
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'test-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });
    const execution = macro.agentSessions
      .byId('0198a4cc-e138-7670-a308-a6b766602700')
      .codeExecutions.byId('0198a4cc-e138-7670-a308-a6b766602788');

    const found = await macro.connectedApps.discover(execution, 'Linear');
    const inspection = await found.connectors[0]?.inspect();
    const added = await macro.connectedApps.addServer(execution, {
      url: 'https://mcp.linear.app/mcp',
      serverName: 'Linear',
    });

    expect(found.connectors.map((connector) => connector.toJSON())).toEqual([
      { slug: 'linear', name: 'Linear', description: 'Issues' },
    ]);
    expect(found.moreResults).toBe(false);
    expect(inspection).toEqual({
      connected: false,
      actions: [{ name: 'create_issue', description: 'Create an issue' }],
      actionsTruncated: false,
      connectMarkup:
        '<m-connect-app>{"appSlug":"linear","name":"Linear"}</m-connect-app>',
    });
    expect(added.summary).toBe('Added Linear.');
    const base =
      'https://agent.example.test/agent-sessions/0198a4cc-e138-7670-a308-a6b766602700/code-executions/0198a4cc-e138-7670-a308-a6b766602788/connected-apps';
    expect(requests).toEqual([
      {
        url: `${base}/discover`,
        body: { operation: 'search', query: 'Linear' },
      },
      {
        url: `${base}/discover`,
        body: { operation: 'inspect', app_slug: 'linear' },
      },
      {
        url: `${base}/servers`,
        body: { url: 'https://mcp.linear.app/mcp', serverName: 'Linear' },
      },
    ]);
  });

  test('searches tools across connected apps through the harness', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      urls.push(request.url);
      return Response.json({
        matches: [
          {
            app: { kind: 'app', key: 'linear', name: 'Linear' },
            tool: {
              name: 'create_issue',
              description: 'Create a Linear issue',
              inputSchema: { type: 'object' },
            },
          },
        ],
        unsearched: [{ kind: 'custom', key: '0123456789abcdef', name: 'Wiki' }],
      });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'test-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });
    const execution = macro.agentSessions
      .byId('0198a4cc-e138-7670-a308-a6b766602700')
      .codeExecutions.byId('0198a4cc-e138-7670-a308-a6b766602788');

    const found = await macro.connectedApps.searchTools(
      execution,
      'linear issue',
    );

    expect(found.matches.map((tool) => tool.toJSON())).toEqual([
      {
        app: { kind: 'app', key: 'linear', name: 'Linear' },
        name: 'create_issue',
        description: 'Create a Linear issue',
        inputSchema: { type: 'object' },
      },
    ]);
    expect(found.unsearched.map((app) => app.name)).toEqual(['Wiki']);
    expect(urls).toEqual([
      'https://agent.example.test/agent-sessions/0198a4cc-e138-7670-a308-a6b766602700/code-executions/0198a4cc-e138-7670-a308-a6b766602788/connected-apps/tools?query=linear%20issue',
    ]);
  });
});
