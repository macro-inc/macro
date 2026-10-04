import * as engine from '@core/docx-engine/client';
import type {
  EditOp,
  EditResult,
  PageInfo,
  Pos,
  Selection,
  StyleInfo,
} from '@core/docx-engine/types';
import type { LoroDoc } from 'loro-crdt';
import { createSignal, onCleanup } from 'solid-js';
import { DocxCollab } from '../core/docx-collab';
import {
  clearV1,
  configureDocxText,
  DOCX_FORMAT_VERSION,
  DOCX_ORIGINS,
  docxFormatVersion,
  readCollabState,
  readV1State,
  writeCollabState,
} from '../core/docx-loro';
import { createPageRenderer } from './create-page-renderer';

let instances = 0;

/** Points to CSS pixels at 100% zoom. */
export const PX_PER_PT = 96 / 72;

export type DocxEditorOptions = {
  /** Collaborative document, or null for a read-only original. */
  doc: LoroDoc | null;
  /** The uploaded file, shown read-only when there is no shared document. */
  original?: Uint8Array;
  /** Whether this user may change the document. */
  editable: boolean;
  /** The name this person's tracked changes are recorded under. */
  author?: string;
  /** Called with this user's selection when it changes. */
  onSelection?: (selection: Selection | undefined) => void;
  onError?: (error: unknown) => void;
};

/**
 * One open document: the engine session in the worker, its link to the
 * shared document, the page renderer, and the editing state the view shows.
 */
export function createDocxEditor(options: DocxEditorOptions) {
  const docKey = `docx-${++instances}-${Math.random().toString(36).slice(2)}`;
  const [pages, setPages] = createSignal<PageInfo[]>([]);
  const [state, setState] = createSignal<EditResult>();
  const [ready, setReady] = createSignal(false);
  /** Bumps whenever the document's content changes. */
  const [revision, setRevision] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [styles, setStyles] = createSignal<StyleInfo[]>([]);
  const [markup, setMarkupSignal] = createSignal(true);
  let collab: DocxCollab | undefined;
  let disposed = false;

  const renderer = createPageRenderer({
    docKey,
    scale: () => zoom() * PX_PER_PT,
    onError: options.onError,
  });

  function take(result: EditResult | null | undefined) {
    if (!result || disposed) return;
    setState(result);
    if (result.pages) {
      setPages(result.pages);
      renderer.update(result.pages, result.bands ?? []);
    }
    if (result.changed || result.pages) setRevision((r) => r + 1);
    options.onSelection?.(result.selection);
  }

  /** Opens the shared document, migrating the first format if needed. */
  async function openShared(doc: LoroDoc) {
    configureDocxText(doc);
    const version = docxFormatVersion(doc);
    if (version !== undefined && version < DOCX_FORMAT_VERSION) {
      if (!options.editable) {
        return engine.openV1Document(docKey, readV1State(doc));
      }
      // Rewrite the first format once; every editor derives the same
      // blocks from it, so concurrent migrations agree.
      await engine.openV1Document(docKey, readV1State(doc));
      const migrated = await engine.collabState(docKey);
      clearV1(doc);
      writeCollabState(doc, migrated, DOCX_ORIGINS.migrate);
    }
    return engine.openCollabDocument(
      docKey,
      readCollabState(doc),
      Math.floor(Math.random() * 2 ** 48)
    );
  }

  /** Keeps the engine in step with the shared document from now on. */
  function follow(doc: LoroDoc) {
    collab = new DocxCollab(doc, adapter, {
      undo: options.editable,
      selection: () => state()?.selection,
      onRemote: (result, restored) => {
        take(result);
        if (restored)
          run([
            {
              op: 'select',
              anchor: restored.anchor,
              focus: restored.focus,
            },
          ]);
      },
      onError: options.onError,
    });
  }

  /**
   * A viewer of a first-format document shows it as it is until an editor
   * migrates it, then reopens from the shared blocks and follows along.
   */
  function awaitMigration(doc: LoroDoc) {
    const unsubscribe = doc.subscribe(() => {
      if (docxFormatVersion(doc) !== DOCX_FORMAT_VERSION) return;
      unsubscribe();
      void (async () => {
        const reopened = await engine.openCollabDocument(
          docKey,
          readCollabState(doc),
          Math.floor(Math.random() * 2 ** 48)
        );
        if (disposed) return;
        follow(doc);
        show(reopened);
        renderer.invalidate();
      })().catch((error: unknown) => options.onError?.(error));
    });
    onCleanup(unsubscribe);
  }

  function show(opened: { pages: PageInfo[]; state: EditResult }) {
    setPages(opened.pages);
    renderer.update(opened.pages);
    take(opened.state);
  }

  async function open() {
    const doc = options.doc;
    const opened = doc
      ? await openShared(doc)
      : await engine.openDocument(
          docKey,
          (options.original ?? new Uint8Array()).slice().buffer
        );
    if (disposed) return;
    if (options.author) await engine.setAuthor(docKey, options.author);
    if (doc) {
      if (options.editable) await engine.setExternalUndo(docKey, true);
      if (docxFormatVersion(doc) === DOCX_FORMAT_VERSION) follow(doc);
      else awaitMigration(doc);
    }
    show(opened);
    setStyles(await engine.styles(docKey));
    setReady(true);
  }

  const adapter = {
    apply: (ops: EditOp[], group?: string) =>
      engine.applyOps(docKey, ops, group),
    applyRemote: (changes: Parameters<typeof engine.applyRemote>[1]) =>
      engine.applyRemote(docKey, changes),
  };

  // Operations queue up while one is in flight; queued typing merges.
  type Queued = { ops: EditOp[]; group?: string };
  const queue: Queued[] = [];
  let pumping = false;

  function coalesce(): Queued | undefined {
    const first = queue.shift();
    if (!first) return undefined;
    const typing = (q: Queued) =>
      q.group === 'typing' &&
      q.ops.length === 1 &&
      q.ops[0].op === 'insertText';
    if (!typing(first)) return first;
    let text = (first.ops[0] as { text: string }).text;
    while (queue.length && typing(queue[0])) {
      text += (queue.shift()!.ops[0] as { text: string }).text;
    }
    return { ops: [{ op: 'insertText', text }], group: 'typing' };
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (let next = coalesce(); next; next = coalesce()) {
        if (disposed) return;
        try {
          const result = collab
            ? await collab.apply(next.ops, next.group)
            : await engine.applyOps(docKey, next.ops, next.group);
          take(result);
        } catch (error) {
          options.onError?.(error);
        }
      }
    } finally {
      pumping = false;
    }
  }

  /** Runs operations after any already queued. */
  function run(ops: EditOp[], group?: string) {
    if (!ready() && ops.some((op) => op.op !== 'select')) return;
    const editing = ops.some(
      (op) =>
        ![
          'select',
          'move',
          'selectAll',
          'selectWord',
          'selectParagraph',
        ].includes(op.op)
    );
    if (editing && !options.editable) return;
    queue.push({ ops, group });
    void pump();
  }

  async function undo() {
    if (collab) {
      collab.undo();
      return;
    }
    take(await engine.undo(docKey));
  }

  async function redo() {
    if (collab) {
      collab.redo();
      return;
    }
    take(await engine.redo(docKey));
  }

  async function setMarkup(next: boolean) {
    setMarkupSignal(next);
    take(await engine.setMarkup(docKey, next));
  }

  open().catch((error: unknown) => options.onError?.(error));

  onCleanup(() => {
    disposed = true;
    collab?.dispose();
    renderer.dispose();
    void engine.closeDocument(docKey).catch(() => {});
  });

  return {
    docKey,
    ready,
    pages,
    state,
    revision,
    styles,
    zoom,
    setZoom(next: number) {
      if (Math.abs(next - zoom()) < 0.001) return;
      setZoom(next);
      renderer.invalidate();
    },
    markup,
    setMarkup,
    renderer,
    run,
    undo,
    redo,
    canUndo: () => (collab ? collab.canUndo() : !!state()?.format.canUndo),
    canRedo: () => (collab ? collab.canRedo() : !!state()?.format.canRedo),
    hitTest: (page: number, x: number, y: number) =>
      engine.hitTest(docKey, page, x, y),
    caretAt: (pos: Pos) => engine.caretAt(docKey, pos),
    rangeRects: (from: Pos, to: Pos) => engine.rangeRects(docKey, from, to),
    paragraphs: () => engine.paragraphs(docKey),
    selectedText: () => engine.selectedText(docKey),
    /** The selection for the clipboard (paragraphs, HTML and text). */
    copySelection: () => engine.copySelection(docKey),
    save: () => engine.saveDocument(docKey),
    /** Waits until queued operations and remote changes are applied. */
    async idle() {
      while (pumping || queue.length)
        await new Promise((r) => setTimeout(r, 5));
      await collab?.idle();
    },
  };
}

export type DocxEditor = ReturnType<typeof createDocxEditor>;
