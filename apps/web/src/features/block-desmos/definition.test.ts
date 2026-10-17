import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  file: vi.fn(),
  bytes: vi.fn(),
  flag: true,
}));

vi.mock('@queries/storage/binary-document', () => ({
  fetchBinaryDocumentData: state.file,
}));

vi.mock('@service-storage/util/fetchBinary', () => ({
  fetchBinary: state.bytes,
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    isFeatureEnabled: (flag: { key?: string }) =>
      flag?.key === 'enable-desmos-editor'
        ? state.flag
        : actual.isFeatureEnabled(flag as never),
  };
});

vi.mock('./desmos-block', () => ({ default: () => null }));

const documentFile = {
  blobUrl: 'https://files.example/graph',
  documentId: 'graph-1',
  fileType: 'desmos',
};

describe('desmos block loading', () => {
  beforeEach(() => {
    state.file.mockReset();
    state.bytes.mockReset();
    state.flag = true;
  });

  it('rejects sources that are not stored documents', async () => {
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'sync-service', id: 'graph-1' },
      'navigate'
    );
    expect(loaded.isErr()).toBe(true);
    expect(state.file).not.toHaveBeenCalled();
  });

  it('skips bytes on preload', async () => {
    state.file.mockResolvedValue(ok(documentFile));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'dss', id: 'graph-1' },
      'preload'
    );
    expect(loaded.isOk() && loaded.value).toEqual({
      type: 'preload',
      origin: { type: 'dss', id: 'graph-1' },
    });
    expect(state.bytes).not.toHaveBeenCalled();
  });

  it('returns the file without text when the editor flag is off', async () => {
    state.flag = false;
    state.file.mockResolvedValue(ok(documentFile));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'dss', id: 'graph-1' },
      'navigate'
    );
    expect(loaded.isOk() && loaded.value).toMatchObject({
      ...documentFile,
      text: null,
    });
    expect(state.bytes).not.toHaveBeenCalled();
  });

  it('decodes stored JSON when the editor flag is on', async () => {
    state.file.mockResolvedValue(ok(documentFile));
    state.bytes.mockResolvedValue(
      ok(new TextEncoder().encode('{"version":1,"expressions":[]}').buffer)
    );
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'dss', id: 'graph-1' },
      'navigate'
    );
    expect(loaded.isOk() && 'text' in loaded.value && loaded.value.text).toBe(
      '{"version":1,"expressions":[]}'
    );
    expect(state.bytes).toHaveBeenCalledWith(
      documentFile.blobUrl,
      'arraybuffer'
    );
  });

  it('passes storage errors through', async () => {
    state.file.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
    const { definition } = await import('./definition');
    const loaded = await definition.load(
      { type: 'dss', id: 'graph-1' },
      'navigate'
    );
    expect(loaded.isErr()).toBe(true);
  });
});
