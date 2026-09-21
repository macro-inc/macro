import { fetchWithToken } from '@core/util/fetchWithToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentHarnessServiceClient } from './client';

vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'agent-harness': 'https://harness.example.com' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function errorHandler() {
  const handler = vi
    .mocked(fetchWithToken)
    .mock.calls.at(-1)?.[1]?.errorResponseHandler;
  if (!handler) throw new Error('Missing session error handler');
  return handler;
}

describe('session request errors', () => {
  it('explains repository access failures on create', async () => {
    agentHarnessServiceClient.create({});
    const error = await errorHandler()(
      new Response('repository is not available to this user', { status: 403 })
    );
    expect(error.message).toContain('Connect GitHub to Macro');
  });

  it('preserves the service reason when a control request is rejected', async () => {
    agentHarnessServiceClient.control('session-1', {
      type: 'setModel',
      model: 'missing',
    });
    const error = await errorHandler()(
      new Response('Model is unavailable.', { status: 422 })
    );
    expect(error.message).toBe('Model is unavailable.');
  });

  it('does not display an HTML proxy error as a service message', async () => {
    agentHarnessServiceClient.create({});
    const error = await errorHandler()(
      new Response('<html>upstream failure</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    expect(error.message).toBe('Agent request failed (HTTP 502).');
  });
});

describe('repository listing', () => {
  it("asks the harness for the caller's repositories", () => {
    agentHarnessServiceClient.listRepositories();
    expect(fetchWithToken).toHaveBeenCalledWith(
      'https://harness.example.com/agent-repositories',
      { method: 'GET' }
    );
  });
});
