/**
 * Team library values the engine returns (`fig_engine::library`).
 */

import type { StyleInfo } from './design-types';

/** What kind of asset a node is. */
export type AssetKind =
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'STYLE'
  | 'VARIABLE'
  | 'COLLECTION';

/** A library a file uses: its document id and name. */
export interface LibraryRef {
  id: string;
  name: string;
}

/** One entry of "Changes to publish". */
export interface AssetChange {
  key: string | null;
  /** The node, when it still exists. */
  id: string | null;
  name: string;
  kind: AssetKind;
  change: 'NEW' | 'CHANGED' | 'REMOVED';
  description: string | null;
  set: string | null;
}

/** A file's publishing state (`fig_engine::library::LibraryStatus`). */
export interface LibraryStatus {
  published: boolean;
  /** Assets a publish would share (private ones left out). */
  assets: number;
  changes: AssetChange[];
  /** The last publish's note. */
  note: string | null;
}

/** A published variable. */
export interface VariableAsset {
  collection: string;
  resolvedType: string;
  /** `RRGGBBAA` for a color. */
  color: string | null;
}

/** A published asset (`fig_engine::library::PublishedAsset`). */
export interface PublishedAsset {
  key: string;
  id: string;
  name: string;
  kind: AssetKind;
  version: string;
  description: string | null;
  /** For a variant: its component set's name and key. */
  set: string | null;
  setKey: string | null;
  page: number | null;
  width: number;
  height: number;
  style: StyleInfo | null;
  variable: VariableAsset | null;
}

/** A library's published assets (`fig_engine::library::PublishedLibrary`). */
export interface PublishedLibrary {
  published: boolean;
  note: string | null;
  assets: PublishedAsset[];
}

/** A copy of a library asset in this file. */
export interface LibraryCopy {
  key: string;
  id: string;
  name: string;
  kind: AssetKind;
  /** The library (a Macro document id, or Figma's key). */
  library: string | null;
  /** The version it was copied at. */
  version: string | null;
  setKey: string | null;
}

/** The libraries a file uses and its copies of their assets. */
export interface LibraryUse {
  enabled: LibraryRef[];
  copies: LibraryCopy[];
}

/** `fig_engine::edit::LibrarySpec`: what importing a package does. */
export interface LibrarySpec {
  library: string;
  /** Replace copies whose version differs. */
  update?: boolean;
  /** Edits in the same step, naming assets as `key:<key>`. */
  then?: unknown[];
}

/** A package of library assets (`FigFile.libraryPackage`). */
export interface LibraryPackage {
  document: Uint8Array;
  images: Uint8Array;
}
