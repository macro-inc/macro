import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

const { fetchWithToken } = vi.hoisted(() => ({ fetchWithToken: vi.fn() }));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { SERVER_HOSTS } from '@core/constant/servers';
import { teamAgentsClient } from './team-agents';

type ErrorHandler = (response: Response) => Promise<unknown>;

async function createFailure(status: number, body: unknown) {
  fetchWithToken.mockClear();
  await teamAgentsClient.create({
    name: 'Ada',
    jobDescription: 'Triage support email.',
    personality: 'Warm.',
    size: 'standard',
    purchaseKey: 'purchase-1',
  });
  const init = fetchWithToken.mock.calls[0]?.[1] as {
    errorResponseHandler: ErrorHandler;
  };
  return init.errorResponseHandler(
    new Response(JSON.stringify(body), { status })
  );
}

describe('teamAgentsClient', () => {
  it('posts the invite to the caller team', async () => {
    fetchWithToken.mockClear();
    await teamAgentsClient.create({
      name: 'Ada',
      jobDescription: 'Triage support email.',
      personality: 'Warm.',
      size: 'xl',
      avatarUrl: null,
      purchaseKey: 'purchase-1',
    });

    expect(fetchWithToken.mock.calls[0]?.[0]).toBe(
      `${SERVER_HOSTS['auth-service']}/team_agents`
    );
    expect(fetchWithToken.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        name: 'Ada',
        jobDescription: 'Triage support email.',
        personality: 'Warm.',
        size: 'xl',
        avatarUrl: null,
        purchaseKey: 'purchase-1',
      }),
    });
  });

  it("keeps the server's client-safe reason a computer can't be bought", async () => {
    await expect(
      createFailure(409, { message: "the computer can't be bought: sold out" })
    ).resolves.toEqual({
      code: 'COMPUTER_UNAVAILABLE',
      message: "the computer can't be bought: sold out",
    });
  });

  it('tells a failed workspace repository apart from other failures', async () => {
    await expect(
      createFailure(502, { message: 'nothing was charged' })
    ).resolves.toMatchObject({ code: 'REPOSITORY_FAILED' });
    await expect(createFailure(403, { message: 'off' })).resolves.toMatchObject(
      { code: 'AGENTS_NOT_ENABLED' }
    );
    await expect(
      createFailure(400, { message: 'bad name' })
    ).resolves.toMatchObject({ code: 'INVALID_AGENT' });
    await expect(createFailure(500, {})).resolves.toMatchObject({
      code: 'SERVER_ERROR',
    });
  });

  it('removes an agent by its encoded user id', async () => {
    fetchWithToken.mockClear();
    await teamAgentsClient.remove('macro|ada@agents.macro.invalid');

    expect(fetchWithToken).toHaveBeenCalledWith(
      `${SERVER_HOSTS['auth-service']}/team_agents/macro%7Cada%40agents.macro.invalid`,
      { method: 'DELETE' }
    );
  });

  it('reads a missing voice as none, and keeps other failures', async () => {
    const voiceUrl = `${SERVER_HOSTS['auth-service']}/team_agents/macro%7Cada%40agents.macro.invalid/voice`;
    fetchWithToken.mockReset();
    fetchWithToken.mockResolvedValueOnce(
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );
    const missing = await teamAgentsClient.voice(
      'macro|ada@agents.macro.invalid'
    );
    expect(missing.isOk() && missing.value).toBeNull();
    expect(fetchWithToken).toHaveBeenCalledWith(voiceUrl);

    fetchWithToken.mockResolvedValueOnce(
      err([{ code: 'FORBIDDEN', message: 'Forbidden' }])
    );
    const forbidden = await teamAgentsClient.voice(
      'macro|ada@agents.macro.invalid'
    );
    expect(forbidden.isErr()).toBe(true);

    fetchWithToken.mockResolvedValueOnce(ok({ model: 'aura-2-thalia-en' }));
    const saved = await teamAgentsClient.voice(
      'macro|ada@agents.macro.invalid'
    );
    expect(saved.isOk() && saved.value).toEqual({ model: 'aura-2-thalia-en' });
  });

  it('puts the voice and names an unknown voice apart from a repository failure', async () => {
    fetchWithToken.mockReset();
    await teamAgentsClient.setVoice('macro|ada@agents.macro.invalid', {
      model: 'aura-2-arcas-en',
    });
    const [url, init] = fetchWithToken.mock.calls[0] as [
      string,
      { method: string; body: string; errorResponseHandler: ErrorHandler },
    ];
    expect(url).toBe(
      `${SERVER_HOSTS['auth-service']}/team_agents/macro%7Cada%40agents.macro.invalid/voice`
    );
    expect(init).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ model: 'aura-2-arcas-en' }),
    });
    await expect(
      init.errorResponseHandler(new Response('{}', { status: 400 }))
    ).resolves.toMatchObject({ code: 'INVALID_VOICE' });
    await expect(
      init.errorResponseHandler(new Response('{}', { status: 502 }))
    ).resolves.toMatchObject({ code: 'REPOSITORY_FAILED' });
    await expect(
      init.errorResponseHandler(new Response('{}', { status: 404 }))
    ).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });
});
