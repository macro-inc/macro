/**
 * What the Photoshop editor needs from the app, injected by the block (or
 * a test fixture) so the editor itself has no app dependencies.
 */

import type { PsdEngine, SavedFile } from '@core/psd-engine/client';
import type { EditResult } from '@core/psd-engine/types';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { PsdPeer, PsdPresence, Version } from '../core/presence';

/** Presence of the other people in a shared document. */
export interface PsdCollaboration {
  /** This person's peer id. */
  peerId: string;
  /** This person's color (a palette color name). */
  color: Accessor<string>;
  peers: Accessor<PsdPeer[]>;
  /** Shares where this person is; frequent calls are throttled. */
  setPresence: (presence: PsdPresence) => void;
  status: Accessor<'connected' | 'connecting' | 'offline'>;
}

/**
 * Edits shared with other people (`queries/psd-sharing.ts`). The editor
 * calls it in order with its own edits.
 */
export interface PsdSharing {
  /** The layer id session (1–65535) this person creates layers in. */
  session: number;
  /** Applies other people's changes that arrived; `null` when none did. */
  pull: () => Promise<EditResult | null>;
  /** Shares this person's steps (and undo or redo) since the last call. */
  push: () => Promise<void>;
  /** Calls `listener` when other people's changes arrive. */
  onIncoming: (listener: () => void) => () => void;
  /** The shared version the engine holds, recorded with a stored file. */
  appliedVersion: () => Version;
  /**
   * Records that a file is about to be stored (and its layer grids), so
   * whoever opens it applies the shared changes to it. `false` when that
   * could not reach the sync service (offline): the file is not stored.
   */
  willStore: (saved: SavedFile) => Promise<boolean>;
  /** Tells everyone a file holding `version` was stored. */
  markStored: (version: Version) => void;
  /** Calls `listener` when someone else stored everything seen here. */
  onStoredElsewhere: (listener: () => void) => () => void;
  /**
   * Calls `listener` when the shared document started over on a file
   * stored outside it (a new upload, an AI edit): this copy is out of date.
   */
  onReplaced: (listener: () => void) => () => void;
  close: () => void;
}

export interface PsdEditorContext {
  engine: PsdEngine;
  fileName: () => string;
  download: (blob: Blob, name: string) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  /** Whether the person may edit the document. */
  canEdit: () => boolean;
  /** Stores the edited `.psd` as a new version; absent where nothing is stored. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Other people in the document, when it is shared live. */
  collaboration?: PsdCollaboration;
  /** The live edits of a shared document. */
  sharing?: PsdSharing;
}

const Context = createContext<PsdEditorContext>();

export function PsdEditorProvider(props: {
  context: PsdEditorContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function usePsdEditorContext(): PsdEditorContext {
  const context = useContext(Context);
  if (!context) throw new Error('PsdEditorProvider is missing');
  return context;
}
