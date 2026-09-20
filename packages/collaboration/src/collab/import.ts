import type { ImportStatus, LoroDoc } from 'loro-crdt';
import type { LoroRawUpdate } from './shared';

const SHALLOW_ROOT_ERROR =
  "You cannot switch a document to a version before the shallow history's start version.";

/** Import the initial state without checking out a version before its shallow root. */
export function importLoroUpdate(
  doc: LoroDoc,
  update: LoroRawUpdate
): ImportStatus {
  try {
    return doc.import(update);
  } catch (error) {
    if (
      String(error) !== SHALLOW_ROOT_ERROR ||
      doc.isDetached() ||
      doc.oplogFrontiers().length > 0
    ) {
      throw error;
    }
  }

  // Loro 1.13.7 can reject an attached empty doc when a shallow snapshot has
  // independent frontier heads: https://github.com/loro-dev/loro/issues/1095.
  // Retry only that empty-doc failure while detached, then attach directly to
  // the imported version. Other shallow snapshots need the normal import path
  // to resolve retained dependencies. No peer IDs or history are manufactured.
  doc.detach();
  try {
    return doc.import(update);
  } finally {
    doc.attach();
  }
}
