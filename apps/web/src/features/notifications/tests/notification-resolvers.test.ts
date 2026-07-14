import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItemPreview = vi.fn();

vi.mock('@queries/preview', () => ({
  getItemPreview: (...args: unknown[]) => getItemPreview(...args),
  isAccessiblePreviewItem: (item: { loading: boolean; access?: string }) =>
    !item.loading && item.access === 'access',
}));

vi.mock('@core/user', () => ({
  tryMacroId: () => undefined,
  macroIdToEmail: () => undefined,
  useDisplayName: () => [() => undefined],
}));

vi.mock('@core/constant/allBlocks', () => ({
  itemToResolvedBlockName: () => undefined,
}));

// Importing the resolver pulls in @service-storage/client, whose module init
// opens a websocket; stub it out before the dynamic import.
vi.stubGlobal(
  'WebSocket',
  class {
    addEventListener() {}
    close() {}
  }
);

const { DefaultDocumentNameResolver } = await import(
  '../notification-resolvers'
);

describe('DefaultDocumentNameResolver', () => {
  beforeEach(() => {
    getItemPreview.mockReset();
  });

  it('maps email_thread entity type to the email item type', async () => {
    getItemPreview.mockResolvedValue({
      id: 'thread-1',
      type: 'email',
      loading: false,
      access: 'access',
      name: 'Test Subject',
      rawName: 'Test Subject',
    });

    const name = await DefaultDocumentNameResolver('thread-1', 'email_thread');

    expect(getItemPreview).toHaveBeenCalledWith({
      id: 'thread-1',
      type: 'email',
    });
    expect(name).toBe('Test Subject');
  });

  it('skips the preview fetch for entity types without a preview fetcher', async () => {
    const name = await DefaultDocumentNameResolver('team-1', 'team');

    expect(getItemPreview).not.toHaveBeenCalled();
    expect(name).toBeUndefined();
  });
});
