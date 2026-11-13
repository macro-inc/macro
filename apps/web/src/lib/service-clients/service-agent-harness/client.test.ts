import { fetchWithToken } from '@core/util/fetchWithToken';
import { ThrownResultError } from '@core/util/result';
import { providerCredentialRejectedMessage } from '@queries/agents/probe-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentHarnessServiceClient,
  PROVIDER_CREDENTIAL_REJECTED,
} from './client';

vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'agent-harness': 'https://harness.example.com' },
  SYNC_SERVICE_HOSTS: { worker: 'https://sync.example.com' },
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
    await agentHarnessServiceClient.create({});
    const error = await errorHandler()(
      new Response('repository is not available to this user', { status: 403 })
    );
    expect(error.message).toContain('Connect GitHub to Macro');
  });

  it('preserves the service reason when a control request is rejected', async () => {
    await agentHarnessServiceClient.control('session-1', {
      type: 'setModel',
      model: 'missing',
    });
    const error = await errorHandler()(
      new Response('Model is unavailable.', { status: 422 })
    );
    expect(error.message).toBe('Model is unavailable.');
  });

  it('does not display an HTML proxy error as a service message', async () => {
    await agentHarnessServiceClient.create({});
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
  it("asks the harness for the caller's repositories", async () => {
    await agentHarnessServiceClient.listRepositories();
    expect(fetchWithToken).toHaveBeenCalledWith(
      'https://harness.example.com/agent-repositories',
      { method: 'GET' }
    );
  });

  it("asks the harness for one repository's branches", async () => {
    await agentHarnessServiceClient.listRepositoryBranches(
      'https://github.com/macro-inc/macro'
    );
    expect(fetchWithToken).toHaveBeenCalledWith(
      'https://harness.example.com/agent-repositories/branches?repoUrl=https%3A%2F%2Fgithub.com%2Fmacro-inc%2Fmacro',
      { method: 'GET' }
    );
  });
});

describe('provider probe errors', () => {
  const reconnect =
    'Cursor refused your connected API key. Reconnect Cursor in Settings with a personal or service-account Cursor API key.';

  it.each([
    [
      'model discovery',
      () => agentHarnessServiceClient.loadAgentModels({ harness: 'cursor' }),
    ],
    [
      'capability discovery',
      () =>
        agentHarnessServiceClient.discoverAgentCapabilities({
          harness: 'cursor',
        }),
    ],
  ])(
    'carries the reconnect message for a refused credential on %s',
    async (_, call) => {
      await call();
      const error = await errorHandler()(
        new Response(
          JSON.stringify({
            code: 'provider_credential_rejected',
            message: reconnect,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      );
      expect(error).toEqual({
        code: PROVIDER_CREDENTIAL_REJECTED,
        message: reconnect,
      });
      expect(
        providerCredentialRejectedMessage(new ThrownResultError([error]))
      ).toBe(reconnect);
    }
  );

  it('keeps a disconnected runtime and other failures generic', async () => {
    await agentHarnessServiceClient.loadAgentModels({ harness: 'cursor' });
    const disconnected = await errorHandler()(
      new Response('the requested harness is disconnected', {
        status: 409,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
    expect(disconnected.code).toBe('CONFLICT');
    const failed = await errorHandler()(
      new Response('model probe failed', { status: 502 })
    );
    expect(failed.code).toBe('HTTP_ERROR');
    expect(
      providerCredentialRejectedMessage(new ThrownResultError([failed]))
    ).toBeUndefined();
    expect(providerCredentialRejectedMessage(new Error('x'))).toBeUndefined();
  });
});
