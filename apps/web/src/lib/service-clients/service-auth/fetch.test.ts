/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { err, ok } from 'neverthrow';

const macroApiToken = vi.fn();

vi.mock('./client', () => ({
  authServiceClient: { macroApiToken },
  getExpiresAt: (token: string) => {
    try {
      const payload: unknown = JSON.parse(atob(token.split('.')[1]));
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('exp' in payload)
      ) {
        return 0;
      }

      const expValue = payload.exp;
      if (typeof expValue !== 'number' && typeof expValue !== 'string') {
        return 0;
      }

      const exp = Number(expValue) * 1000;
      return Number.isFinite(exp) ? exp : 0;
    } catch {
      return 0;
    }
  },
}));

function jwt(exp: unknown) {
  const payload = btoa(JSON.stringify({ exp }));
  return `header.${payload}.signature`;
}

describe('getMacroApiToken', () => {
  beforeEach(() => {
    vi.resetModules();
    macroApiToken.mockReset();
  });

  test('reuses an unexpired cached token', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    macroApiToken.mockResolvedValue(ok({ macro_api_token: token }));
    const { getMacroApiToken } = await import('./fetch');

    await expect(getMacroApiToken()).resolves.toBe(token);
    await expect(getMacroApiToken()).resolves.toBe(token);

    expect(macroApiToken).toHaveBeenCalledTimes(1);
  });

  test('refreshes an expired cached token', async () => {
    const expired = jwt(Math.floor(Date.now() / 1000) - 60);
    const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
    macroApiToken
      .mockResolvedValueOnce(ok({ macro_api_token: expired }))
      .mockResolvedValueOnce(ok({ macro_api_token: fresh }));
    const { getMacroApiToken } = await import('./fetch');

    await expect(getMacroApiToken()).resolves.toBe(expired);
    await expect(getMacroApiToken()).resolves.toBe(fresh);

    expect(macroApiToken).toHaveBeenCalledTimes(2);
  });

  test('refreshes a cached token with a non-scalar exp', async () => {
    const malformed = jwt([Math.floor(Date.now() / 1000) + 3600]);
    const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
    macroApiToken
      .mockResolvedValueOnce(ok({ macro_api_token: malformed }))
      .mockResolvedValueOnce(ok({ macro_api_token: fresh }));
    const { getMacroApiToken } = await import('./fetch');

    await expect(getMacroApiToken()).resolves.toBe(malformed);
    await expect(getMacroApiToken()).resolves.toBe(fresh);

    expect(macroApiToken).toHaveBeenCalledTimes(2);
  });

  test('deduplicates concurrent requests when the cache is empty', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    macroApiToken.mockImplementation(async () => {
      await gate;
      return ok({ macro_api_token: token });
    });
    const { getMacroApiToken } = await import('./fetch');

    const first = getMacroApiToken();
    const second = getMacroApiToken();

    expect(macroApiToken).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([token, token]);
  });

  test('deduplicates concurrent refreshes of an expired cached token', async () => {
    const expired = jwt(Math.floor(Date.now() / 1000) - 60);
    const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
    macroApiToken.mockResolvedValueOnce(ok({ macro_api_token: expired }));
    const { getMacroApiToken } = await import('./fetch');

    await expect(getMacroApiToken()).resolves.toBe(expired);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    macroApiToken.mockImplementationOnce(async () => {
      await gate;
      return ok({ macro_api_token: fresh });
    });

    const first = getMacroApiToken();
    const second = getMacroApiToken();

    await Promise.resolve();
    expect(macroApiToken).toHaveBeenCalledTimes(2);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([fresh, fresh]);
  });

  test('does not permanently cache a rejected token request', async () => {
    const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
    macroApiToken
      .mockResolvedValueOnce(
        err([{ code: 'UNAUTHORIZED' as const, message: 'Unauthorized access' }])
      )
      .mockResolvedValueOnce(ok({ macro_api_token: fresh }));
    const { getMacroApiToken } = await import('./fetch');

    await expect(getMacroApiToken()).rejects.toBeDefined();
    await expect(getMacroApiToken()).resolves.toBe(fresh);

    expect(macroApiToken).toHaveBeenCalledTimes(2);
  });
});
