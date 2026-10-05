import {
  closeDocument,
  collabState,
  openDocument,
} from '@core/docx-engine/client';
import { LoroDoc } from 'loro-crdt';
import { writeCollabState } from './docx-loro';

let seeds = 0;

/**
 * The first collaborative snapshot of an uploaded DOCX: the engine opens it
 * once and its shared state goes into a new Loro document. Block ids are
 * assigned in document order, so every peer that seeds the same upload
 * derives the same ids (only one seed is ever stored).
 */
export async function buildSeedSnapshot(
  bytes: Uint8Array
): Promise<Uint8Array> {
  const key = `docx-seed-${++seeds}`;
  await openDocument(key, bytes.slice().buffer);
  try {
    const state = await collabState(key);
    const doc = new LoroDoc();
    writeCollabState(doc, state);
    return doc.export({ mode: 'snapshot' });
  } finally {
    await closeDocument(key).catch(() => {});
  }
}
