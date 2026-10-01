import type { AutomergeDoc } from '@macro-inc/automerge';
import { createAutomergeDoc } from './manager';
import type { RawUpdate } from './shared';

export function automergeDocFromSnapshot(snapshot: RawUpdate): AutomergeDoc {
  const automergeDoc = createAutomergeDoc();
  automergeDoc.import(snapshot);
  return automergeDoc;
}

export function compareAutomergeDocVersions(
  a: AutomergeDoc,
  b: AutomergeDoc
): number {
  const aVersion = a.version();
  return aVersion.compare(b.version()) ?? 0;
}
