/**
 * What the Illustrator editor needs from the app, supplied by the block
 * (or a test fixture) so the editor itself has no app dependencies.
 */

import type { AiEngine } from '@core/ai-engine/client';
import type { EditResult } from '@core/ai-engine/types';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { AiPeer, AiPresence, Version } from '../core/presence';

/** Presence of the other people in a shared document. */
export interface AiCollaboration {
  /** This person's peer id. */
  peerId: string;
  /** This person's color (a palette color name). */
  color: Accessor<string>;
  peers: Accessor<AiPeer[]>;
  /** Shares where this person is; frequent calls are throttled. */
  setPresence: (presence: AiPresence) => void;
  status: Accessor<'connected' | 'connecting' | 'offline'>;
}

/**
 * Edits shared with other people (`queries/ai-sharing.ts`). The editor
 * calls it in order with its own edits.
 */
export interface AiSharing {
  /** The id session this person creates objects in. */
  session: number;
  /** Applies other people's changes that arrived; `null` when none did. */
  pull: () => Promise<EditResult | null>;
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
   * Calls `listener` when the shared document started over on a file
   * stored outside it (a new upload, an AI edit): this copy is out of date.
   */
  onReplaced: (listener: () => void) => () => void;
  close: () => void;
}

/** A font on this computer, with its file. */
export interface AiLocalFont {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  bytes: () => Promise<ArrayBuffer>;
}

/**
 * Where text layout gets fonts: Google Fonts stylesheets and files, and
 * the fonts on this computer (the Figma editor's source fulfils it).
 */
export interface AiFontSource {
  /** A stylesheet's text (Google's css2 API). */
  stylesheet: (url: string) => Promise<string>;
  /** A font file. */
  file: (url: string) => Promise<ArrayBuffer>;
  /** The fonts on this computer already permitted, without asking. */
  grantedLocalFonts?: () => Promise<AiLocalFont[] | null>;
}

export interface AiEditorContext {
  engine: AiEngine;
  fileName: () => string;
  download: (blob: Blob, name: string) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  /** Whether the person may edit the document. */
  canEdit: () => boolean;
  /** Stores the edited `.ai` as a new version; absent when nothing can be saved. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Other people in the document, when it is shared live. */
  collaboration?: AiCollaboration;
  /** The live edits of a shared document. */
  sharing?: AiSharing;
  /** Fonts for laying out edited text (Inter alone without it). */
  fonts?: AiFontSource;
}

const Context = createContext<AiEditorContext>();

export function AiEditorProvider(props: {
  context: AiEditorContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useAiEditorContext(): AiEditorContext {
  const context = useContext(Context);
  if (!context) throw new Error('AiEditorProvider is missing');
  return context;
}
