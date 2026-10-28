import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { spreadsheetDraftUpdate } from './draft-update';

function write(doc: LoroDoc, address: string, value: string) {
  doc.getMap('spreadsheetCells').set(address, { value });
  doc.commit();
}

describe('spreadsheet draft operation attribution', () => {
  it('registers the original operation peers when a draft contains multiple sessions', () => {
    const server = new LoroDoc();
    const first = new LoroDoc();
    const second = new LoroDoc();
    try {
      server.getMap('spreadsheetMeta').set('formatVersion', 1);
      server.commit();
      write(first, 'A1', 'First session');
      second.import(first.export({ mode: 'snapshot' }));
      write(second, 'B1', 'Second session');
      const result = spreadsheetDraftUpdate(
        second.export({ mode: 'snapshot' }),
        server.export({ mode: 'snapshot' })
      );
      expect(new Set(result.peerIds)).toEqual(
        new Set([first.peerId, second.peerId])
      );
      server.import(result.update);
      expect(server.getMap('spreadsheetCells').toJSON()).toEqual(
        second.getMap('spreadsheetCells').toJSON()
      );
      const retry = spreadsheetDraftUpdate(
        second.export({ mode: 'snapshot' }),
        server.export({ mode: 'snapshot' })
      );
      expect(retry.peerIds).toEqual([]);
      const before = server.exportJsonUpdates();
      server.import(retry.update);
      expect(server.exportJsonUpdates()).toEqual(before);
    } finally {
      second.free();
      first.free();
      server.free();
    }
  });

  it('does not rebind an existing collaborator peer even when its draft has later operations', () => {
    const server = new LoroDoc();
    const collaborator = new LoroDoc();
    const draft = new LoroDoc();
    try {
      write(collaborator, 'A1', 'Already synced');
      server.import(collaborator.export({ mode: 'snapshot' }));
      write(collaborator, 'A2', 'Pending collaborator operation');
      draft.import(collaborator.export({ mode: 'snapshot' }));
      write(draft, 'B1', 'Draft owner operation');
      const result = spreadsheetDraftUpdate(
        draft.export({ mode: 'snapshot' }),
        server.export({ mode: 'snapshot' })
      );
      expect(result.peerIds).toEqual([draft.peerId]);
      server.import(result.update);
      expect(server.getMap('spreadsheetCells').toJSON()).toEqual(
        draft.getMap('spreadsheetCells').toJSON()
      );
    } finally {
      draft.free();
      collaborator.free();
      server.free();
    }
  });
});
