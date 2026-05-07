import type { LoroDoc } from 'loro-crdt';
import { createLoroDoc } from './manager';
import type { RawUpdate } from './shared';

export function loroDocFromSnapshot(snapshot: RawUpdate): LoroDoc {
  const loroDoc = createLoroDoc();
  loroDoc.import(snapshot);
  return loroDoc;
}

export function compareLoroDocVersions(a: LoroDoc, b: LoroDoc): number {
  const aVersion = a.version();
  return aVersion.compare(b.version()) ?? 0;
}
