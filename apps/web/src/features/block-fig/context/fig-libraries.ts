/**
 * Where team libraries come from: the other designs the person can open,
 * and their stored files. The app fulfils it with document storage
 * (`queries/fig-libraries.ts`); the browser fixture with files in memory.
 */

import type { Accessor } from 'solid-js';

/** A design document that may be used as a library. */
export interface FigLibraryDocument {
  id: string;
  name: string;
}

export interface FigLibrarySource {
  /** This design's document id (other files name it as their library). */
  documentId: string;
  /** The designs the person can open; `undefined` while loading. */
  documents: Accessor<readonly FigLibraryDocument[] | undefined>;
  /** A design's stored `.fig` file, as it is now. */
  load: (id: string) => Promise<ArrayBuffer>;
}
