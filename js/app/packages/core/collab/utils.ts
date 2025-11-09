import type { InferType } from '@loro-mirror/packages/core/src';
import type { LoroDoc } from 'loro-crdt';
import { createLoroDoc, createMirror } from './manager';
import type { GenericRootSchema, RawUpdate } from './shared';

// HACK: hack to get around async nature of mirror sync,
// which we have no control over
async function awaitMirrorSync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Converts a raw state to a loro snapshot
 * @param schema - The schema to use for the snapshot
 * @param state - The state to convert to a snapshot
 * @returns A promise that resolves to the snapshot or undefined if it fails
 */
export async function rawStateToLoroSnapshot<
  S extends GenericRootSchema = GenericRootSchema,
>(schema: S, state: InferType<S>): Promise<Uint8Array | undefined> {
  const loroDoc = createLoroDoc();
  const mirror = createMirror(loroDoc, schema);

  mirror.setState(state);

  mirror.sync();
  await awaitMirrorSync();

  let snapshot: Uint8Array | undefined;

  try {
    snapshot = loroDoc.export({ mode: 'snapshot' });
  } catch (e) {
    console.error('Failed to export snapshot', e);
    return undefined;
  }

  return snapshot;
}

export function loroDocFromSnapshot(snapshot: RawUpdate): LoroDoc {
  const loroDoc = createLoroDoc();
  loroDoc.import(snapshot);
  return loroDoc;
}

export function compareLoroDocVersions(a: LoroDoc, b: LoroDoc): number {
  const aVersion = a.version();
  return aVersion.compare(b.version()) ?? 0;
}
