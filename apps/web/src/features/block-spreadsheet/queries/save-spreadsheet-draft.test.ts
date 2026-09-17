import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { LoroDoc } from 'loro-crdt';
import { errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSpreadsheetRows,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  resizeSpreadsheetColumn,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { saveSpreadsheetDraft } from './save-spreadsheet-draft';

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), connect: vi.fn() }));
vi.mock('@queries/storage/documentLoad/documentLoadBundle', () => ({
  fetchDocumentLoadBundle: mocks.bundle,
}));
vi.mock('@service-sync/source', () => ({
  createSyncServiceSource: mocks.connect,
}));

describe('saving a local spreadsheet before sharing', () => {
  let server: LoroDoc;
  let draft: LoroDoc;
  beforeEach(() => {
    vi.clearAllMocks();
    server = new LoroDoc();
    server.getMap('spreadsheetMeta').set('formatVersion', 1);
    server.commit();
    draft = new LoroDoc();
    writeSpreadsheetCells(draft, {
      A1: { value: 'Budget', bold: true },
      B1: { value: '=SUM(B2:B4)', format: 'currency' },
    });
    appendSpreadsheetRows(draft, 100);
    resizeSpreadsheetColumn(draft, 0, 240);
    mocks.bundle.mockResolvedValue(
      ok({ token: 'test-token', userAccessLevel: 'owner' })
    );
  });
  afterEach(() => {
    server.free();
    draft.free();
  });

  function connect() {
    const source = {
      ...createNoopLiveSyncSource('saved-sheet'),
      pushUpdate: vi.fn(async (updates: Uint8Array[]) => {
        for (const update of updates) server.import(update);
        return true;
      }),
      registerPeerId: vi.fn(),
      cleanup: vi.fn(),
    };
    const doInitialSync = vi.fn(() =>
      okAsync({
        snapshot: server.export({
          mode: 'shallow-snapshot',
          frontiers: server.frontiers(),
        }),
        awareness: new Uint8Array(),
      })
    );
    mocks.connect.mockReturnValue({ source, doInitialSync });
    return { source, doInitialSync };
  }

  it('preserves formulas, formatting and layout, and waits for the save ACK', async () => {
    const { source } = connect();
    let acknowledge: (value: boolean) => void = () => {};
    source.pushUpdate.mockImplementation(async (updates) => {
      for (const update of updates) server.import(update);
      return new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      });
    });
    let saved = false;
    const operation = saveSpreadsheetDraft(
      'saved-sheet',
      draft.export({ mode: 'snapshot' })
    );
    async function observeSave() {
      await operation;
      saved = true;
    }
    const observed = observeSave();
    await vi.waitFor(() => expect(source.pushUpdate).toHaveBeenCalledOnce());
    expect(source.registerPeerId).toHaveBeenCalledExactlyOnceWith(draft.peerId);
    expect(source.registerPeerId.mock.invocationCallOrder[0]).toBeLessThan(
      source.pushUpdate.mock.invocationCallOrder[0]
    );
    expect(saved).toBe(false);
    expect(source.cleanup).not.toHaveBeenCalled();
    acknowledge(true);
    await observed;
    expect(readSpreadsheetCells(server)).toEqual(readSpreadsheetCells(draft));
    expect(readSpreadsheetLayout(server)).toEqual(readSpreadsheetLayout(draft));
    expect(server.getMap('spreadsheetMeta').get('formatVersion')).toBe(1);
    expect(source.cleanup).toHaveBeenCalledOnce();
  });

  it('retries a lost ACK without duplicating rows and includes later draft edits', async () => {
    const first = connect();
    first.source.pushUpdate.mockImplementation(async (updates) => {
      for (const update of updates) server.import(update);
      return false;
    });
    await expect(
      saveSpreadsheetDraft('saved-sheet', draft.export({ mode: 'snapshot' }))
    ).rejects.toThrow('not acknowledged');
    expect(first.source.cleanup).toHaveBeenCalledOnce();
    writeSpreadsheetCells(draft, { A1: null, B2: { value: '123' } });
    const retry = connect();
    await saveSpreadsheetDraft(
      'saved-sheet',
      draft.export({ mode: 'snapshot' })
    );
    expect(readSpreadsheetCells(server)).toEqual(readSpreadsheetCells(draft));
    expect(readSpreadsheetLayout(server).rowCount).toBe(300);
    expect(retry.source.registerPeerId).not.toHaveBeenCalled();
  });

  it('does not write when the initial connection fails', async () => {
    const { source } = connect();
    mocks.connect.mockReturnValue({
      source,
      doInitialSync: () => errAsync({ type: 'timeout', duration: 10000 }),
    });
    await expect(
      saveSpreadsheetDraft('saved-sheet', draft.export({ mode: 'snapshot' }))
    ).rejects.toThrow('connect');
    expect(source.pushUpdate).not.toHaveBeenCalled();
    expect(source.cleanup).toHaveBeenCalledOnce();
  });

  it('rejects read-only access before opening a sync connection', async () => {
    mocks.bundle.mockResolvedValue(
      ok({ token: 'viewer-token', userAccessLevel: 'view' })
    );
    await expect(
      saveSpreadsheetDraft('saved-sheet', draft.export({ mode: 'snapshot' }))
    ).rejects.toThrow('read-only');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
