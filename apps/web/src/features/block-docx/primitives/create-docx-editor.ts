import type { DocxEditor } from 'docxodus';
import type { LoroDoc } from 'loro-crdt';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { bridgeEngine, type DocxEngine } from '../core/docx-engine';
import { readDocxState } from '../core/docx-loro';
import { assemblePackage } from '../core/docx-package';
import { DOCX_SYNC_SESSION_SETTINGS } from '../core/docx-seed';
import { DocxSyncController } from '../core/docx-sync';
import { editorBridge } from '../core/editor-bridge';
import { caretRange, contentOffset, contentText } from '../core/text-offsets';
import type { DocxodusRuntime } from '../queries/docxodus-runtime';

/** Commit typing this long after the last keystroke so peers see it live. */
const IDLE_COMMIT_MS = 1_200;
/** Coalesce bursts of engine mutations into one publish. */
const PUBLISH_DELAY_MS = 80;

export type DocxEditorOptions = {
  runtime: DocxodusRuntime;
  /** The collaborative document; null opens `original` read-only, unsynced. */
  doc: LoroDoc | null;
  original?: Uint8Array;
  editable: boolean;
  author: string;
  /** The scrolling element around the document, kept in place on remounts. */
  scroller?: () => HTMLElement | undefined;
  /** Called after remote changes land (`subscribe` receives the trigger). */
  subscribeRemote?: (listener: () => void) => () => void;
  onError?: (error: unknown) => void;
};

export type DocxEditorHandle = {
  editor: Accessor<DocxEditor | undefined>;
  /** Bumps whenever the rendered document changes (local or remote). */
  revision: Accessor<number>;
  /** Mount the editor into `element`. */
  mount: (element: HTMLElement) => Promise<void>;
  /** Publish committed local edits now (e.g. before leaving). */
  flush: () => void;
  /** The editor's live document bytes, without engine bookkeeping. */
  save: () => Uint8Array | undefined;
};

let mountCounter = 0;

/**
 * Own one Docxodus editor and keep it in step with the collaborative
 * document: local engine mutations are published, remote changes are patched
 * into the live session, and typing is committed while the user pauses.
 */
export function createDocxEditor(options: DocxEditorOptions): DocxEditorHandle {
  const [editor, setEditor] = createSignal<DocxEditor>();
  const [revision, setRevision] = createSignal(0);
  const bump = () => setRevision((value) => value + 1);
  let container: HTMLElement | undefined;
  let controller: DocxSyncController | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let applying = false;
  let unsubscribeRemote: (() => void) | undefined;
  const rootId = `docx-editor-${++mountCounter}`;
  const rootSelector = `[data-docx-editor="${rootId}"]`;

  const publish = () => {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    if (!controller || applying || disposed) return;
    try {
      if (controller.publishLocal()) bump();
    } catch (error) {
      options.onError?.(error);
    }
  };
  const schedulePublish = () => {
    if (applying || !options.doc) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publish, PUBLISH_DELAY_MS);
  };

  const exports = editorBridge(options.runtime.exports, {
    rootSelector,
    sessionSettings: DOCX_SYNC_SESSION_SETTINGS,
    onMutation: () => {
      schedulePublish();
      bump();
    },
  });

  const engine: DocxEngine = bridgeEngine(
    options.runtime.exports.DocxSessionBridge,
    () => {
      const current = editor();
      if (!current) throw new Error('DOCX editor is not mounted');
      return current.sessionHandle;
    }
  );

  const editorOptions = () => ({
    editable: options.editable,
    comments: false,
    // Docxodus renders header/footer stories as editing bands only; readers
    // get the print layout, where every page carries its header and footer.
    headerFooter: options.editable,
    paginated: !options.editable,
    blockDrag: options.editable,
    revisionAuthor: options.author,
    commentAuthor: options.author,
  });

  /** A fresh child for each editor instance; the scoped root stays stable. */
  const freshHost = () => {
    const host = document.createElement('div');
    host.className = 'docx-editor-host';
    container!.replaceChildren(host);
    return host;
  };

  const activeBlock = (): HTMLElement | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container?.contains(active))
      return null;
    return active.closest<HTMLElement>('[data-anchor][contenteditable="true"]');
  };
  const isDirty = (block: HTMLElement) =>
    block.dataset.committedText !== undefined &&
    contentText(block) !== block.dataset.committedText;

  /** True while a block (or a paragraph inside it) holds uncommitted typing. */
  const isBusy = (blockId: string) => {
    const block = activeBlock();
    if (!block || !isDirty(block)) return false;
    if (block.getAttribute('data-anchor') === blockId) return true;
    const owner = container?.querySelector(
      `[data-anchor="${CSS.escape(blockId)}"]`
    );
    return !!owner?.contains(block);
  };

  /**
   * Commit the block the user is typing in without moving their caret: the
   * editor commits on blur, so blur and restore focus at the same offset.
   */
  const commitTyping = () => {
    idleTimer = undefined;
    const block = activeBlock();
    if (!block || !isDirty(block)) return;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    if (!block.contains(selection.anchorNode)) return;
    const offset = contentOffset(
      block,
      selection.anchorNode,
      selection.anchorOffset
    );
    const id = block.getAttribute('data-anchor');
    const scrollParent = options.scroller?.();
    const scrollTop = scrollParent?.scrollTop;
    block.blur();
    const fresh =
      (id &&
        container?.querySelector<HTMLElement>(
          `[data-anchor="${CSS.escape(id)}"][contenteditable="true"]`
        )) ||
      null;
    if (!fresh) return;
    fresh.focus({ preventScroll: true });
    const caret = caretRange(fresh, offset);
    if (caret) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    if (scrollParent && scrollTop !== undefined)
      scrollParent.scrollTop = scrollTop;
  };

  const onInput = (event: Event) => {
    if ((event as InputEvent).isComposing) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(commitTyping, IDLE_COMMIT_MS);
  };

  const rebuild = (bytes: Uint8Array) => {
    const previous = editor();
    const scrollParent = options.scroller?.();
    const scrollTop = scrollParent?.scrollTop ?? 0;
    previous?.close();
    const next = options.runtime.module.DocxEditor.open(
      freshHost(),
      bytes,
      exports,
      editorOptions()
    );
    setEditor(next);
    if (scrollParent) scrollParent.scrollTop = scrollTop;
  };

  const applyRemote = () => {
    if (!controller || disposed) return;
    applying = true;
    try {
      controller.applyRemote();
    } catch (error) {
      options.onError?.(error);
    } finally {
      applying = false;
    }
    bump();
  };

  async function mount(element: HTMLElement) {
    container = element;
    container.setAttribute('data-docx-editor', rootId);
    container.addEventListener('input', onInput);
    const bytes = options.doc
      ? assemblePackage(readDocxState(options.doc))
      : options.original;
    if (!bytes) throw new Error('No document to open');
    const opened = await options.runtime.module.DocxEditor.openAsync(
      freshHost(),
      bytes,
      exports,
      editorOptions()
    );
    if (disposed) {
      opened.close();
      return;
    }
    setEditor(opened);
    if (options.doc) {
      controller = new DocxSyncController(options.doc, {
        engine: () => engine,
        refresh: () => editor()?.refresh(),
        rebuild,
        isBusy,
      });
      unsubscribeRemote = options.subscribeRemote?.(applyRemote);
      // Changes that arrived while the editor was mounting.
      applyRemote();
    }
    bump();
  }

  const onHide = () => {
    if (document.visibilityState === 'hidden') publish();
  };
  document.addEventListener('visibilitychange', onHide);

  onCleanup(() => {
    publish();
    disposed = true;
    unsubscribeRemote?.();
    clearTimeout(idleTimer);
    document.removeEventListener('visibilitychange', onHide);
    container?.removeEventListener('input', onInput);
    editor()?.close();
  });

  return {
    editor,
    revision,
    mount,
    flush: publish,
    save: () => editor()?.save(),
  };
}
