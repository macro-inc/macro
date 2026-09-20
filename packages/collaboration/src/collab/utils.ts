import type { LoroDoc } from 'loro-crdt';
import { importLoroUpdate } from './import';
import { createLoroDoc } from './manager';
import type { RawUpdate } from './shared';

export function loroDocFromSnapshot(snapshot: RawUpdate): LoroDoc {
  const loroDoc = createLoroDoc();
  importLoroUpdate(loroDoc, snapshot);
  return loroDoc;
}

export function compareLoroDocVersions(a: LoroDoc, b: LoroDoc): number {
  const aVersion = a.version();
  return aVersion.compare(b.version()) ?? 0;
}
