import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ file: vi.fn(), markdown: vi.fn() }));
vi.mock('@core/block', () => ({
  defineBlock: (value: unknown) => value,
  LoadErrors: { INVALID: 'invalid' },
}));
vi.mock('@queries/storage/documentLoad/sync-document-context', () => ({
  fetchFileDocumentOpenContext: state.file,
  fetchSyncDocumentOpenContext: state.markdown,
}));
vi.mock('./DocxBlock', () => ({ default: () => null }));

const context = {
  syncService: true,
  documentMetadata: { documentId: 'doc', fileType: 'docx' },
  userAccessLevel: 'edit',
  fromCache: false,
  token: 'token',
};

describe('write block loading', () => {
  beforeEach(() => {
    state.file.mockReset();
    state.markdown.mockReset();
  });

  // An uploaded DOCX is a stored file, never sync-service content, so the
  // Markdown open context rejects it with INVALID ("Unable to load").
  it('opens an uploaded DOCX through the file open context, not the Markdown one', async () => {
    state.file.mockResolvedValue(ok(context));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'sync-service', id: 'doc' },
      'navigate'
    );
    expect(loaded.isOk() && loaded.value).toEqual(context);
    expect(state.file).toHaveBeenCalledWith('doc');
    expect(state.markdown).not.toHaveBeenCalled();
  });

  it('passes load errors through', async () => {
    state.file.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'sync-service', id: 'doc' },
      'navigate'
    );
    expect(loaded.isErr() && loaded.error).toEqual([{ code: 'UNAUTHORIZED' }]);
  });
});
