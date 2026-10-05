/**
 * What the viewer needs from the app, injected by the block so the viewer
 * itself has no app dependencies.
 */

import type { EditResult, FigEngine } from '@core/fig-engine/client';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { LocalFont } from '../core/fonts';
import type { FigPeer, FigPresence, Version } from '../core/presence';
import type { FigCommentStore } from './fig-comments';
import type { FigLibrarySource } from './fig-libraries';

/** Presence of the other people in a shared design. */
export interface FigCollaboration {
  /** This person's peer id. */
  peerId: string;
  /** This person's color (a palette color name). */
  color: Accessor<string>;
  peers: Accessor<FigPeer[]>;
  /** Shares where this person is; frequent calls are throttled. */
  setPresence: (presence: FigPresence) => void;
  status: Accessor<'connected' | 'connecting' | 'offline'>;
}

/**
 * Edits shared with other people (`queries/fig-sharing.ts`). The editor
 * calls it in order with its own edits.
 */
export interface FigSharing {
  /** Applies other people's changes that arrived; `null` when none did. */
  pull: (page: number) => Promise<EditResult | null>;
  /** Shares this person's edits (and undo or redo) since the last call. */
  push: () => Promise<void>;
  /** Calls `listener` when other people's changes arrive. */
  onIncoming: (listener: () => void) => () => void;
  /** The shared version the engine holds, recorded with a stored file. */
  appliedVersion: () => Version;
  /**
   * Records that `bytes` are about to be stored, so whoever opens them
   * applies the shared changes to them. `false` when that could not reach
   * the sync service (offline): the file is then not stored.
   */
  willStore: (bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>;
  /** Tells everyone a file holding `version` was stored. */
  markStored: (version: Version) => void;
  /** Calls `listener` when someone else stored everything seen here. */
  onStoredElsewhere: (listener: () => void) => () => void;
  /**
   * Calls `listener` when the shared design started over on a file stored
   * outside it (a new upload, an AI edit): this copy is out of date.
   */
  onReplaced: (listener: () => void) => () => void;
  close: () => void;
}

/** A font on this computer, with its file. */
export interface LocalFontFile extends LocalFont {
  bytes: () => Promise<ArrayBuffer>;
}

/**
 * Where text layout gets fonts (`queries/font-source.ts`): Google Fonts
 * stylesheets and files (cached), and the fonts on this computer.
 */
export interface FigFontSource {
  /** A stylesheet's text (Google's css2 API). */
  stylesheet: (url: string) => Promise<string>;
  /** A font file. */
  file: (url: string) => Promise<ArrayBuffer>;
  /**
   * The fonts on this computer, asking permission first (call from a user
   * gesture); absent where the browser cannot list them.
   */
  localFonts?: () => Promise<LocalFontFile[]>;
  /** Fonts on this computer already permitted, without asking. */
  grantedLocalFonts?: () => Promise<LocalFontFile[] | null>;
}

export interface FigViewerContext {
  engine: FigEngine;
  fileName: () => string;
  download: (blob: Blob, name: string) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  /** Whether the person may edit the file. */
  canEdit?: () => boolean;
  /** Stores the edited `.fig` as a new version. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Identifies the file on the clipboard (the document id). */
  fileKey?: string;
  /** Other people in the design, when it is shared live. */
  collaboration?: FigCollaboration;
  /** The live edits of a shared design. */
  sharing?: FigSharing;
  /** Comments on the design; absent where they are not available. */
  comments?: FigCommentStore;
  /** A link that opens the design presenting `frameId`. */
  frameLink?: (frameId: string) => string;
  /** A frame to start presenting when the viewer opens (from a link). */
  presentAt?: string;
  /** Fonts for laying out edited text (Inter alone without it). */
  fonts?: FigFontSource;
  /** Other designs to use as team libraries; absent where there are none. */
  libraries?: FigLibrarySource;
}

const Context = createContext<FigViewerContext>();

export function FigViewerProvider(props: {
  context: FigViewerContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useFigViewerContext(): FigViewerContext {
  const context = useContext(Context);
  if (!context) throw new Error('FigViewerProvider is missing');
  return context;
}
