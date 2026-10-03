/**
 * The capabilities the PPTX editor needs from its host: one open
 * presentation engine, a way to persist new versions, and permissions.
 * Production wiring lives in `pptx-block.tsx`; the browser fixture supplies
 * its own.
 */

import type {
  DeckOutline,
  EditOp,
  EditResult,
  SlideOutline,
  TextLayoutInfo,
} from '@core/pptx-engine/types';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';

/** Undo/redo availability after a change. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditOutcome {
  /** `null` when an undo/redo had nothing to do. */
  result: EditResult | null;
  history: HistoryState;
}

/** One open presentation. Every call is answered in the order it was made. */
export interface PresentationEngine {
  outline: () => Promise<DeckOutline>;
  slideOutline: (index: number) => Promise<SlideOutline>;
  /** Renders slide `index` `width` pixels wide. */
  render: (index: number, width: number) => Promise<ImageBitmap>;
  /** Everything except `shape` (`without`), or the shape alone (`only`). */
  renderLayer: (
    index: number,
    width: number,
    mode: 'without' | 'only',
    shape: number
  ) => Promise<ImageBitmap>;
  textLayout: (index: number, shape: number) => Promise<TextLayoutInfo | null>;
  /** Applies a batch atomically; batches sharing `group` merge into one undo step. */
  apply: (ops: EditOp[], group?: string) => Promise<EditOutcome>;
  breakGroup: () => Promise<EditOutcome>;
  undo: () => Promise<EditOutcome>;
  redo: () => Promise<EditOutcome>;
  /** The current presentation as `.pptx` bytes. */
  save: () => Promise<Uint8Array>;
  /**
   * Replaces the open presentation with `bytes` (transferred), dropping its
   * undo history. Rejects, keeping the current one, when they can't be read.
   */
  reopen: (bytes: ArrayBuffer) => Promise<void>;
  /** Releases the engine's memory. */
  close: () => void;
}

export interface PptxEditorContext {
  engine: PresentationEngine;
  /** Stores bytes as the document's new version. Rejects when that fails. */
  persist: (bytes: Uint8Array) => Promise<void>;
  /** Whether the viewer may edit. */
  canEdit: Accessor<boolean>;
  /** File name for downloads (with extension). */
  fileName: Accessor<string>;
  /** Hands a file to the user (download). */
  download: (bytes: Uint8Array, fileName: string) => void;
  /** Reports a failure to the user. */
  notifyError: (message: string) => void;
  /** Tells the user about something that is not a failure. */
  notifyInfo?: (message: string) => void;
  /**
   * Calls `onChange` when the stored file changes outside this editor (an
   * AI edit, say); returns an unsubscribe. Hosts without such signals omit it.
   */
  watchStoredFile?: (onChange: () => void) => () => void;
  /** Downloads the latest stored version, for reloading after outside changes. */
  fetchLatest?: () => Promise<ArrayBuffer>;
  /** Quiet period before an automatic save (ms); `0` saves only on demand. */
  autosaveDelay?: number;
}

const Context = createContext<PptxEditorContext>();

export function PptxEditorProvider(props: {
  context: PptxEditorContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function usePptxEditorContext(): PptxEditorContext {
  const context = useContext(Context);
  if (!context) throw new Error('PptxEditorProvider is required');
  return context;
}
