import { afterEach, describe, expect, test } from 'bun:test';
import type { Agent as AgentRecord } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('agents', () => {
  test('coding() lists built-in and configured coding personas that start sessions', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url.endsWith('/coding-agents')) {
        return Response.json({
          agents: [
            {
              id: '00000000-0000-0000-0000-00000000c5c5',
              name: 'Cursor',
              description: 'Cursor cloud agents, run with your Cursor account.',
              instructions: '',
              harness: 'cursor',
              model: null,
            },
            {
              id: '0198a4cc-e138-7670-a308-a6b766602701',
              name: 'Web maintainer',
              description: null,
              instructions: 'Owns acme/web.',
              harness: 'macrod',
              model: 'claude-sonnet',
            },
          ],
        });
      }
      return Response.json(
        {
          session: {
            botId: '00000000-0000-0000-0000-00000000c5c5',
            canEdit: true,
            createdAt: '2026-08-24T12:00:00Z',
            harness: 'cursor',
            id: '0198a4cc-e138-7670-a308-a6b766602700',
            model: null,
            modifiedAt: '2026-08-24T12:00:00Z',
            name: 'Cursor session',
            archivedBy: null,
            archivedAt: null,
            ownerId: 'macro|owner@example.com',
            sandboxSize: 'default',
            status: { kind: 'no_messages' },
            workspace: '/workspace',
          },
        },
        { status: 201 },
      );
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    const coding = await macro.agents.coding();

    expect(
      coding.map(({ agent, ...facts }) => ({ id: agent.id, ...facts })),
    ).toEqual([
      {
        id: '00000000-0000-0000-0000-00000000c5c5',
        name: 'Cursor',
        description: 'Cursor cloud agents, run with your Cursor account.',
        instructions: '',
        harness: 'cursor',
        model: undefined,
      },
      {
        id: '0198a4cc-e138-7670-a308-a6b766602701',
        name: 'Web maintainer',
        description: undefined,
        instructions: 'Owns acme/web.',
        harness: 'macrod',
        model: 'claude-sonnet',
      },
    ]);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('https://agent.example.test/coding-agents');

    await macro.agentSessions.createManaged({
      agent: coding[0]?.agent,
      prompt: 'Fix the login redirect loop',
      repoUrl: 'https://github.com/acme/web',
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      botId: '00000000-0000-0000-0000-00000000c5c5',
      prompt: 'Fix the login redirect loop',
      repoUrl: 'https://github.com/acme/web',
    });
  });

  test('a listed agent reads its full settings', async () => {
    const record: AgentRecord = {
      auto_accept_permissions: true,
      bot: {
        created_at: '2026-08-24T12:00:00Z',
        description: 'Keeps acme/web healthy.',
        handle: 'web-maintainer',
        has_agent: true,
        id: '0198a4cc-e138-7670-a308-a6b766602701',
        kind: 'owned',
        name: 'Web maintainer',
        updated_at: '2026-08-24T12:00:00Z',
      },
      channel_ids: ['0198a4cc-e138-7670-a308-a6b766602709'],
      channel_scope: 'selected',
      default_model: 'claude-sonnet',
      harness: 'macrod',
      harness_id: '0198a4cc-e138-7670-a308-a6b766602708',
      instructions: 'Owns acme/web.',
      is_coding: true,
      mcp: {
        scope: 'selected',
        servers: [{ app_slug: 'linear', server_name: 'Linear' }],
      },
    };
    globalThis.fetch = (async (_input) =>
      Response.json([record])) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const [agent] = await macro.agents.list();

    expect(agent).toBeDefined();
    if (!agent) return;
    await expect(agent.handle()).resolves.toBe('web-maintainer');
    await expect(agent.description()).resolves.toBe('Keeps acme/web healthy.');
    await expect(agent.harness()).resolves.toBe('macrod');
    await expect(agent.isCoding()).resolves.toBe(true);
    await expect(agent.autoAcceptPermissions()).resolves.toBe(true);
    await expect(agent.channelScope()).resolves.toBe('selected');
    await expect(agent.apps()).resolves.toEqual({
      scope: 'selected',
      servers: [{ appSlug: 'linear', name: 'Linear' }],
    });
  });

  test('a built-in persona says where to read it instead of failing opaquely', async () => {
    globalThis.fetch = (async (_input) => Response.json([])) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    await expect(
      macro.agents.byId('00000000-0000-0000-0000-00000000c5c5').name(),
    ).rejects.toThrow('agents.coding()');
  });
  test('update() sends only the settings it is given', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({});
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const agent = macro.agents.byId('0198a4cc-e138-7670-a308-a6b766602701');

    await agent.update({ instructions: 'Ship small diffs.' });
    await agent.update({
      runtime: {
        harness: 'macrod',
        host: macro.harnesses.byId('0198a4cc-e138-7670-a308-a6b766602708'),
      },
      channels: {
        scope: 'selected',
        channels: [macro.channels.byId('0198a4cc-e138-7670-a308-a6b766602709')],
      },
      apps: {
        scope: 'selected',
        servers: [{ appSlug: 'linear', name: 'Linear' }],
      },
      defaultModel: 'claude-sonnet',
      autoAcceptPermissions: false,
      isCoding: true,
    });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        'PATCH',
        'https://storage.example.test/agents/0198a4cc-e138-7670-a308-a6b766602701',
      ],
      [
        'PATCH',
        'https://storage.example.test/agents/0198a4cc-e138-7670-a308-a6b766602701',
      ],
    ]);
    await expect(requests[0]?.json()).resolves.toEqual({
      instructions: 'Ship small diffs.',
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      harness: {
        harness: 'macrod',
        harness_id: '0198a4cc-e138-7670-a308-a6b766602708',
      },
      channels: {
        channel_scope: 'selected',
        channel_ids: ['0198a4cc-e138-7670-a308-a6b766602709'],
      },
      mcp: {
        scope: 'selected',
        servers: [{ app_slug: 'linear', server_name: 'Linear' }],
      },
      default_model: 'claude-sonnet',
      auto_accept_permissions: false,
      is_coding: true,
    });
  });
});
