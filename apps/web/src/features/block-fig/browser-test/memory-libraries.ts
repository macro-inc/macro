/**
 * Designs kept in memory for the fixture's team libraries (`?libraries`):
 * each has an id, a name, and its stored file, which saving replaces, as
 * document storage does in the app. A design's `FigLibrarySource` lists the
 * others.
 */

import { createSignal } from 'solid-js';
import type {
  FigLibraryDocument,
  FigLibrarySource,
} from '../context/fig-libraries';

export function createMemoryLibraries(
  initial: { id: string; name: string; bytes: ArrayBuffer }[]
) {
  const files = new Map(initial.map((d) => [d.id, d.bytes]));
  const [documents] = createSignal<FigLibraryDocument[]>(
    initial.map(({ id, name }) => ({ id, name }))
  );
  /** How many times each design was read as a library. */
  const reads = new Map<string, number>();
  return {
    documents,
    /** A design's stored file (a copy). */
    bytes: (id: string) => files.get(id)?.slice(0),
    /** Stores a design's new version. */
    store: (id: string, bytes: Uint8Array) => {
      files.set(id, bytes.slice().buffer);
    },
    reads: (id: string) => reads.get(id) ?? 0,
    /** The libraries `id` may use. */
    source: (id: string): FigLibrarySource => ({
      documentId: id,
      documents: () => documents().filter((d) => d.id !== id),
      load: async (other) => {
        const bytes = files.get(other);
        if (!bytes) throw new Error('This design is not available');
        reads.set(other, (reads.get(other) ?? 0) + 1);
        return bytes.slice(0);
      },
    }),
  };
}

export type MemoryLibraries = ReturnType<typeof createMemoryLibraries>;
