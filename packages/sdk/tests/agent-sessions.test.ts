import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentSessionResponse } from '../generated/agent-harness/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const sessionId = '0198a4cc-e138-7670-a308-a6b766602700';
const session: AgentSessionResponse = {
  botId: '0198a4cc-e138-7670-a308-a6b766602701',
  createdAt: '2026-08-24T12:00:00Z',
  harness: 'claude-code',
  id: sessionId,
  model: 'claude-sonnet',
  modifiedAt: '2026-08-24T12:00:00Z',
  name: 'Agent Session',
  ownerId: 'macro|owner@example.com',
  sandboxSize: 'default',
  status: { kind: 'no_messages' },
  workspace: '/workspace',
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AgentSession', () => {
  test('renames through the agent-harness service with user auth', async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    await macro.agentSessions.byId(sessionId).rename('Fix Flaky Tests');

    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe(
      `https://agent.example.test/agent-sessions/${sessionId}/name`,
    );
    expect(request?.headers.get('authorization')).toBe('Bearer user-token');
    await expect(request?.json()).resolves.toEqual({ name: 'Fix Flaky Tests' });
  });

  test('resizes a session sandbox through the agent-harness service', async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return Response.json({ size: 'large' }, { status: 200 });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    await expect(
      macro.agentSessions.byId(sessionId).setSandboxSize('large'),
    ).resolves.toBe('large');

    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe(
      `https://agent.example.test/agent-sessions/${sessionId}/sandbox-size`,
    );
    await expect(request?.json()).resolves.toEqual({ size: 'large' });
  });

  test('reads and writes the caller default sandbox size', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({ size: 'small' }, { status: 200 });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    await expect(macro.agentSessions.defaultSandboxSize()).resolves.toBe(
      'small',
    );
    await expect(
      macro.agentSessions.setDefaultSandboxSize('small'),
    ).resolves.toBe('small');

    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
    expect(requests.map((request) => request.url)).toEqual([
      'https://agent.example.test/agent-sandbox-size',
      'https://agent.example.test/agent-sandbox-size',
    ]);
  });

  test('wraps managed creation, control, logs, and deletion', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (
        request.method === 'POST' &&
        request.url.endsWith('/agent-sessions')
      ) {
        return Response.json({ session }, { status: 201 });
      }
      if (request.url.endsWith('/control')) {
        return Response.json(
          { actionId: '0198a4cc-e138-7670-a308-a6b766602702', status: 'sent' },
          { status: 200 },
        );
      }
      if (request.url.endsWith('/log')) {
        return Response.json(
          { bot: { id: session.botId, name: 'Agent' }, entries: [] },
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    const created = await macro.agentSessions.createManaged({
      prompt: 'Fix it',
    });
    await expect(created.name()).resolves.toBe('Agent Session');
    await expect(created.control({ type: 'stop' })).resolves.toEqual({
      actionId: '0198a4cc-e138-7670-a308-a6b766602702',
      status: 'sent',
    });
    await expect(created.log()).resolves.toMatchObject({ entries: [] });
    await created.delete();

    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'POST',
      'GET',
      'DELETE',
    ]);
  });

  test('prompt is sugar over control and reports queueing', async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return Response.json(
        {
          actionId: '0198a4cc-e138-7670-a308-a6b766602703',
          status: 'queued',
        },
        { status: 200 },
      );
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    await expect(
      macro.agentSessions.byId(sessionId).prompt('Fix the flaky test'),
    ).resolves.toEqual({
      actionId: '0198a4cc-e138-7670-a308-a6b766602703',
      status: 'queued',
    });

    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(
      `https://agent.example.test/agent-sessions/${sessionId}/control`,
    );
    await expect(request?.json()).resolves.toEqual({
      type: 'prompt',
      prompt: 'Fix the flaky test',
    });
  });

  test('lists the queue and edits or removes an entry through its handle', async () => {
    const actionId = '0198a4cc-e138-7670-a308-a6b766602704';
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.method === 'GET') {
        return Response.json(
          {
            entries: [
              {
                actionId,
                kind: 'prompt',
                prompt: 'Also update the docs',
                actorUserId: 'macro|teammate@example.com',
                createdAt: '2026-08-24T12:01:00Z',
              },
            ],
          },
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { 'agent-harness': 'https://agent.example.test' },
    });

    const [queued] = await macro.agentSessions.byId(sessionId).queue();
    expect(queued?.actionId).toBe(actionId);
    expect(queued?.kind).toBe('prompt');
    expect(queued?.prompt).toBe('Also update the docs');
    expect(queued?.actorUserId).toBe('macro|teammate@example.com');
    expect(queued?.createdAt).toBe('2026-08-24T12:01:00Z');

    await queued?.edit('Also update the README');
    await queued?.remove();

    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'PUT',
      'DELETE',
    ]);
    expect(requests[1]?.url).toBe(
      `https://agent.example.test/agent-sessions/${sessionId}/queue/${actionId}`,
    );
    await expect(requests[1]?.json()).resolves.toEqual({
      prompt: 'Also update the README',
    });
    expect(requests[2]?.url).toBe(
      `https://agent.example.test/agent-sessions/${sessionId}/queue/${actionId}`,
    );
  });
});
