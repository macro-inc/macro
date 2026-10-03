import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ bundle: vi.fn(), openContext: vi.fn() }));
vi.mock('@core/block', () => ({
  defineBlock: (value: unknown) => value,
  LoadErrors: { INVALID: 'invalid' },
}));
vi.mock('@queries/storage/documentLoad/documentLoadBundle', () => ({
  fetchDocumentLoadBundle: state.bundle,
}));
vi.mock('@queries/storage/documentLoad/sync-document-context', () => ({
  fetchSyncDocumentOpenContext: state.openContext,
}));
vi.mock('./DocxBlock', () => ({ default: () => null }));

const bundle = {
  documentMetadata: { documentId: 'doc', fileType: 'docx' },
  userAccessLevel: 'edit',
  token: 'token',
};

describe('write block loading', () => {
  beforeEach(() => {
    state.bundle.mockReset();
    state.openContext.mockReset();
  });

  // An uploaded DOCX is a stored file, never sync-service content, so the
  // Markdown open context rejects it with INVALID ("Unable to load").
  it('opens an uploaded DOCX from its load bundle, not the Markdown open context', async () => {
    state.bundle.mockResolvedValue(ok(bundle));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'sync-service', id: 'doc' },
      'navigate'
    );
    expect(loaded.isOk() && loaded.value).toEqual(bundle);
    expect(state.bundle).toHaveBeenCalledWith('doc');
    expect(state.openContext).not.toHaveBeenCalled();
  });

  it('passes load errors through', async () => {
    state.bundle.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'sync-service', id: 'doc' },
      'navigate'
    );
    expect(loaded.isErr() && loaded.error).toEqual([{ code: 'UNAUTHORIZED' }]);
  });
});
