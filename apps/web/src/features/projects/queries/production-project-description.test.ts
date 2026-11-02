import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  ensure: vi.fn(),
  mint: vi.fn(),
  token: vi.fn(),
  source: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@service-storage/initiative', () => ({
  initiativeClient: { ensureDescriptionSurface: doubles.ensure },
}));
vi.mock('@core/collab-surface/token', () => ({
  mintCollabSurfaceToken: doubles.mint,
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

function transport(
  viewer: string | null = 'user-1'
): ProjectDescriptionTransport<string> {
  createProductionProjectDescriptionSession('project-1', { viewer });
  const [surfaceId, port] = doubles.session.mock.calls[0];
  // The description surface has the project's id.
  expect(surfaceId).toBe('project-1');
  return port;
}

describe('production project description transport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensures the project surface before minting its connection token', async () => {
    doubles.ensure.mockResolvedValue(ok('project-1'));
    doubles.mint.mockResolvedValue({ token: 'token-1' });

    await expect(
      transport().authorize('project-1', new AbortController().signal)
    ).resolves.toBe('token-1');

    expect(doubles.ensure).toHaveBeenCalledWith('project-1');
    expect(doubles.mint).toHaveBeenCalledWith('project-1', 'user-1');
    expect(doubles.ensure.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.mint.mock.invocationCallOrder[0]
    );
  });

  it('reads the surface as it stands for a caller with no account', async () => {
    doubles.mint.mockResolvedValue({ token: 'token-1' });

    await expect(
      transport(null).authorize('project-1', new AbortController().signal)
    ).resolves.toBe('token-1');

    expect(doubles.ensure).not.toHaveBeenCalled();
    expect(doubles.mint).toHaveBeenCalledWith('project-1', null);
  });

  it('reads a description nobody started as empty for a caller with no account', async () => {
    doubles.mint.mockResolvedValue({ error: 'absent' });

    await expect(
      transport(null).authorize('project-1', new AbortController().signal)
    ).resolves.toBeUndefined();
  });

  it('fails without a connection token', async () => {
    doubles.ensure.mockResolvedValue(ok('project-1'));
    doubles.mint.mockResolvedValue({ error: 'failed' });

    await expect(
      transport().authorize('project-1', new AbortController().signal)
    ).rejects.toThrow('Could not open the project description.');
  });

  it('fails when the surface cannot be ensured', async () => {
    doubles.ensure.mockResolvedValue(
      err([{ code: 'UNAUTHORIZED', message: 'no access' }])
    );

    await expect(
      transport().authorize('project-1', new AbortController().signal)
    ).rejects.toBeDefined();
    expect(doubles.mint).not.toHaveBeenCalled();
  });

  it('does not mint a token once the view has closed', async () => {
    doubles.ensure.mockResolvedValue(ok('project-1'));
    const closed = new AbortController();
    closed.abort();

    await expect(
      transport().authorize('project-1', closed.signal)
    ).rejects.toBeDefined();
    expect(doubles.mint).not.toHaveBeenCalled();
  });

  it('connects through the collab surface source with refreshing tokens', async () => {
    doubles.source.mockReturnValue({ source: {}, doInitialSync: vi.fn() });
    transport().connect('project-1', 'token-1');
    const [surfaceId, token, refresh] = doubles.source.mock.calls[0];
    expect([surfaceId, token]).toEqual(['project-1', 'token-1']);
    doubles.token.mockResolvedValue('token-2');
    await expect(refresh()).resolves.toBe('token-2');
    expect(doubles.token).toHaveBeenCalledWith('project-1', 'user-1');
  });
});
