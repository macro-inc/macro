import { LoroDoc } from 'loro-crdt';
import { bridgeEngine, type DocxSyncBridge } from './docx-engine';
import { seedDocxState } from './docx-loro';

/** Settings every session in a collaborative editor is opened with. */
export const DOCX_SYNC_SESSION_SETTINGS = {
  // The editor re-renders from HTML; markdown patches are wasted work.
  emitMarkdownPatch: false,
  // Raw operations only ever carry XML the engine itself serialized.
  validateRawOps: false,
};

type SeedBridge = DocxSyncBridge & {
  OpenSession: (bytes: Uint8Array, settingsJson: string) => number;
  CloseSession: (handle: number) => void;
};

/**
 * The first collaborative snapshot of an uploaded DOCX: open it once, split
 * the engine's save into blocks and parts, and write them to a new Loro
 * document. Every peer that opens the same upload derives the same block ids.
 */
export function buildSeedSnapshot(
  bridge: SeedBridge,
  bytes: Uint8Array
): Uint8Array {
  const handle = bridge.OpenSession(
    bytes,
    JSON.stringify(DOCX_SYNC_SESSION_SETTINGS)
  );
  try {
    const doc = new LoroDoc();
    seedDocxState(doc, bridgeEngine(bridge, () => handle).snapshot());
    return doc.export({ mode: 'snapshot' });
  } finally {
    bridge.CloseSession(handle);
  }
}
