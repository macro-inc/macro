/**
 * The capabilities the PPTX editor needs from its host: one open
 * presentation engine, a way to persist new versions, and permissions.
 * Production wiring lives in `pptx-block.tsx`; the browser fixture supplies
 * its own.
 */

import type {
  CellRef,
  ClipboardPayload,
  DeckOutline,
  EditOp,
  EditResult,
  FindOptions,
  LinkRegion,
  PresetPath,
  ShapeGeometryInfo,
  SlideOutline,
  TextLayoutInfo,
  TextMatch,
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
  /**
   * The top-level shapes at z-order positions `start..end`, over the
   * background and inherited shapes when `backdrop` (slide show layers).
   */
  renderSpan?: (
    index: number,
    width: number,
    start: number,
    end: number,
    backdrop: boolean
  ) => Promise<ImageBitmap>;
  /** The bytes of a video or audio clip (`MediaOutline.part`). */
  mediaBytes?: (part: string) => Promise<Uint8Array>;
  /** A slide's clickable link areas (slide shows follow them). */
  linkRegions?: (index: number) => Promise<LinkRegion[]>;
  /**
   * A shape's outline as editable paths in shape-local points, with its
   * local → slide transform (Edit Points); `null` for groups and frames.
   */
  geometryPaths?: (
    index: number,
    shape: number
  ) => Promise<ShapeGeometryInfo | null>;
  /**
   * A shape's text laid out for carets, or with `cell` a table cell's (a
   * merged cell's, for a cell it covers); `null` when it holds no text.
   */
  textLayout: (
    index: number,
    shape: number,
    cell?: CellRef
  ) => Promise<TextLayoutInfo | null>;
  /** Applies a batch atomically; batches sharing `group` merge into one undo step. */
  apply: (ops: EditOp[], group?: string) => Promise<EditOutcome>;
  breakGroup: () => Promise<EditOutcome>;
  undo: () => Promise<EditOutcome>;
  redo: () => Promise<EditOutcome>;
  /** The current presentation as `.pptx` bytes. */
  save: () => Promise<Uint8Array>;
  /** Copies shapes of slide `index` for a `pasteShapes` op (any presentation). */
  copyShapes: (index: number, shapes: number[]) => Promise<ClipboardPayload>;
  /** Copies slides (by id) with their notes for a `pasteSlides` op. */
  copySlides: (slides: number[]) => Promise<ClipboardPayload>;
  /** Every occurrence of `query` in slide text, in slide order. */
  findText: (query: string, options?: FindOptions) => Promise<TextMatch[]>;
  /**
   * Replaces the open presentation with `bytes` (transferred), dropping its
   * undo history. Rejects, keeping the current one, when they can't be read.
   * A collaborative engine instead merges the file's changes into the
   * shared presentation, keeping everyone's other edits.
   */
  reopen: (bytes: ArrayBuffer) => Promise<void>;
  /** Releases the engine's memory. */
  close: () => void;
  /** Outlines of preset shapes at `width`×`height` points, for galleries. */
  presetPaths?: (
    names: string[],
    width: number,
    height: number
  ) => Promise<Record<string, PresetPath[]>>;
  /** Whether other people edit the same presentation live. */
  collaborative?: boolean;
  /**
   * Collaborative engines: calls `listener` after changes made elsewhere
   * (other people) reached the engine; returns an unsubscribe.
   */
  onRemoteChange?: (
    listener: (result: EditResult, history: HistoryState) => void
  ) => () => void;
  /** Told about each version this editor stored. */
  onSaved?: (bytes: Uint8Array) => void;
}

/** Where a collaborator is: a slide and the shapes they selected. */
export type PresentationSelection = {
  slide: number;
  shapes: number[];
  /** Whether they are typing in the shape. */
  editing: boolean;
};

export interface PresentationPeer {
  peerId: string;
  userId?: string;
  name: string;
  color: string;
  selection: PresentationSelection;
}

/** Live presence of the other people in a collaborative presentation. */
export interface PresentationCollaboration {
  peers: Accessor<PresentationPeer[]>;
  /** Shares where this person is (`undefined` when nowhere). */
  setSelection: (selection: PresentationSelection | undefined) => void;
  status: Accessor<'connected' | 'connecting' | 'offline'>;
}

export interface PptxEditorContext {
  engine: PresentationEngine;
  /** Stores bytes as the document's new version. Rejects when that fails. */
  persist: (bytes: Uint8Array) => Promise<void>;
  /** Whether the viewer may edit. */
  canEdit: Accessor<boolean>;
  /** File name for downloads (with extension). */
  fileName: Accessor<string>;
  /** Hands a file to the user (download); a .pptx unless `mimeType` says otherwise. */
  download: (bytes: Uint8Array, fileName: string, mimeType?: string) => void;
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
  /** Presence of other people, for collaborative presentations. */
  collaboration?: PresentationCollaboration;
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
