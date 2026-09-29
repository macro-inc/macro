import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  ensure: vi.fn(),
  token: vi.fn(),
  source: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@service-storage/initiative', () => ({
  initiativeClient: { ensureDescriptionSurface: doubles.ensure },
}));
vi.mock('@core/collab-surface/token', () => ({
  getCollabSurfaceToken: doubles.token,
}));
vi.mock('@service-sync/source', () => ({
  createCollabSurfaceSource: doubles.source,
}));
vi.mock('./project-description', () => ({
  createProjectDescriptionSession: doubles.session,
}));

import { createProductionProjectDescriptionSession } from './production-project-description';
import type { ProjectDescriptionTransport } from './project-description';

function transport(): ProjectDescriptionTransport<string> {
  createProductionProjectDescriptionSession({
    projectId: 'project-1',
    surfaceId: 'surface-1',
  });
  const [surfaceId, port] = doubles.session.mock.calls[0];
  expect(surfaceId).toBe('surface-1');
  return port;
}

const preparing = () =>
  err([{ code: 'CONFLICT', message: 'still being prepared' }]);

describe('production project description transport', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('ensures the project surface before minting its connection token', async () => {
    doubles.ensure.mockResolvedValue(ok('surface-1'));
    doubles.token.mockResolvedValue('token-1');

    await expect(
      transport().authorize('surface-1', new AbortController().signal)
    ).resolves.toBe('token-1');

    expect(doubles.ensure).toHaveBeenCalledWith(
      'project-1',
      expect.any(AbortSignal)
    );
    expect(doubles.token).toHaveBeenCalledWith('surface-1');
    expect(doubles.ensure.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.token.mock.invocationCallOrder[0]
    );
  });

  it('fails without a connection token', async () => {
    doubles.ensure.mockResolvedValue(ok('surface-1'));
    doubles.token.mockResolvedValue(undefined);

    await expect(
      transport().authorize('surface-1', new AbortController().signal)
    ).rejects.toThrow('Could not open the project description.');
  });

  it('waits for a description that is still being prepared', async () => {
    vi.useFakeTimers();
    doubles.ensure
      .mockResolvedValueOnce(preparing())
      .mockResolvedValueOnce(preparing())
      .mockResolvedValue(ok('surface-1'));
    doubles.token.mockResolvedValue('token-1');

    const authorized = transport().authorize(
      'surface-1',
      new AbortController().signal
    );
    await vi.runAllTimersAsync();

    await expect(authorized).resolves.toBe('token-1');
    expect(doubles.ensure).toHaveBeenCalledTimes(3);
  });

  it('gives up on a description that never becomes ready', async () => {
    vi.useFakeTimers();
    doubles.ensure.mockResolvedValue(preparing());

    const authorized = transport().authorize(
      'surface-1',
      new AbortController().signal
    );
    const rejected = expect(authorized).rejects.toThrow('still being prepared');
    await vi.runAllTimersAsync();

    await rejected;
    // A bounded number of attempts over about fifteen seconds.
    const attempts = doubles.ensure.mock.calls.length;
    expect(attempts).toBeGreaterThan(5);
    expect(attempts).toBeLessThan(25);
    expect(doubles.token).not.toHaveBeenCalled();
  });

  it('fails at once on any other error', async () => {
    doubles.ensure.mockResolvedValue(
      err([{ code: 'FORBIDDEN', message: 'unauthorized' }])
    );

    await expect(
      transport().authorize('surface-1', new AbortController().signal)
    ).rejects.toThrow('unauthorized');
    expect(doubles.ensure).toHaveBeenCalledTimes(1);
  });

  it('stops waiting once the view closes', async () => {
    vi.useFakeTimers();
    doubles.ensure.mockResolvedValue(preparing());
    const closed = new AbortController();

    const authorized = transport().authorize('surface-1', closed.signal);
    const rejected = expect(authorized).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(100);
    closed.abort();
    await rejected;
    await vi.runAllTimersAsync();

    expect(doubles.ensure).toHaveBeenCalledTimes(1);
  });

  it('abandons a pending ensure request once the view closes', async () => {
    // The client settles an abandoned request as an error.
    doubles.ensure.mockImplementation(
      (_projectId: string, signal: AbortSignal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve(err([{ code: 'UNKNOWN', message: 'aborted' }]))
          )
        )
    );
    const closed = new AbortController();

    const authorized = transport().authorize('surface-1', closed.signal);
    closed.abort();

    await expect(authorized).rejects.toMatchObject({ name: 'AbortError' });
    const [, requestSignal] = doubles.ensure.mock.calls[0];
    expect(requestSignal.aborted).toBe(true);
    expect(doubles.token).not.toHaveBeenCalled();
  });

  it('ends a hanging ensure request when the budget runs out', async () => {
    vi.useFakeTimers();
    doubles.ensure.mockImplementation(
      (_projectId: string, signal: AbortSignal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve(err([{ code: 'UNKNOWN', message: 'aborted' }]))
          )
        )
    );

    const authorized = transport().authorize(
      'surface-1',
      new AbortController().signal
    );
    const rejected = expect(authorized).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    expect(doubles.ensure).toHaveBeenCalledTimes(1);
  });

  it('connects through the collab surface source with refreshing tokens', async () => {
    doubles.source.mockReturnValue({ source: {}, doInitialSync: () => {} });
    doubles.token.mockResolvedValue('token-2');

    transport().connect('surface-1', 'token-1');

    const [surfaceId, token, refresh] = doubles.source.mock.calls[0];
    expect([surfaceId, token]).toEqual(['surface-1', 'token-1']);
    await expect(refresh()).resolves.toBe('token-2');
    expect(doubles.token).toHaveBeenCalledWith('surface-1');
  });
});
