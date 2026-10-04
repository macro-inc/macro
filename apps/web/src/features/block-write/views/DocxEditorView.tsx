import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type DocxAlignment,
  type DocxInlineFormat,
  type DocxParagraphStyle,
  DocxToolbar,
} from '../components/DocxToolbar';
import { blockOf, contentOffset } from '../core/text-offsets';
import { createCommentHighlights } from '../primitives/create-comment-highlights';
import {
  createDocxComments,
  type DocxComments,
} from '../primitives/create-docx-comments';
import { createDocxEditor } from '../primitives/create-docx-editor';
import type { DocxPeer, DocxSelection } from '../queries/docx-session';
import type { DocxodusRuntime } from '../queries/docxodus-runtime';
import { DocxCollaboratorCarets } from './DocxCollaborators';

/** A US Letter sheet at 96 dpi. */
const PAGE_WIDTH = 816;
/** Room for a comment card (280px) and its inset beside the page. */
const MARGIN_WIDTH = 296;
/** The narrowest the page gets beside comment cards: about 60% scale. */
const PAGE_MIN_WIDTH = 480;

/** Paragraph styles offered in the toolbar, when the document defines them. */
const PREFERRED_STYLES = [
  'Normal',
  'Title',
  'Subtitle',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Quote',
];

export type DocxMarginContext = {
  comments: DocxComments;
  editorRoot: HTMLElement | undefined;
  margin: HTMLElement | undefined;
  revision: Accessor<number>;
};

export type DocxEditorViewProps = {
  runtime: DocxodusRuntime;
  /** Collaborative document, or null for a read-only original. */
  doc: LoroDoc | null;
  original?: Uint8Array;
  canEdit: boolean;
  canComment: Accessor<boolean>;
  author: string;
  fileName: string;
  peers: Accessor<DocxPeer[]>;
  displayName: (userId: string | undefined) => string;
  onSelection?: (selection: DocxSelection | undefined) => void;
  subscribeRemote?: (listener: () => void) => () => void;
  /** Comment roots for this document; omit to disable commenting. */
  commentRoots?: Accessor<MessageListItem[]>;
  /** Margin content (comment threads) laid out beside the page. */
  margin?: (context: DocxMarginContext) => JSX.Element;
  /** Content below the page (discussion, detached comments). */
  footer?: (comments: DocxComments) => JSX.Element;
  onDownload: (bytes: Uint8Array) => void;
  onError?: (error: unknown) => void;
  /** Test hook: the mounted editor handle. */
  onReady?: (handle: ReturnType<typeof createDocxEditor>) => void;
};

/** The collaborative DOCX editor: toolbar, page, collaborators and comments. */
export function DocxEditorView(props: DocxEditorViewProps) {
  let scroller!: HTMLDivElement;
  let page!: HTMLDivElement;
  const [editorRoot, setEditorRoot] = createSignal<HTMLDivElement>();
  const [margin, setMargin] = createSignal<HTMLDivElement>();
  const [loading, setLoading] = createSignal(true);
  const [format, setFormat] = createSignal<
    Partial<Record<DocxInlineFormat, boolean>>
  >({});
  const [paragraphStyle, setParagraphStyle] = createSignal<string | null>(null);
  const [trackChanges, setTrackChanges] = createSignal(false);

  const handle = createDocxEditor({
    runtime: props.runtime,
    doc: props.doc,
    original: props.original,
    editable: props.canEdit,
    author: props.author,
    scroller: () => scroller,
    subscribeRemote: props.subscribeRemote,
    onError: props.onError,
  });
  const editor = handle.editor;

  const comments = createDocxComments({
    doc: props.doc,
    roots: () => props.commentRoots?.() ?? [],
    root: editorRoot,
    revision: handle.revision,
    canEdit: () => props.canEdit,
  });
  // The right gutter holds the comment margin. With cards or a draft showing
  // it keeps their width and the page gives way, down to a legible width
  // (narrower panes scroll sideways); otherwise it only needs room for the
  // comment button beside a selection, so the page stays centered.
  const pageColumns = () => {
    const cards =
      !!props.margin && (comments.located().length > 0 || !!comments.draft());
    const gutter = cards ? MARGIN_WIDTH : props.margin ? 48 : 0;
    const pageMin = cards ? PAGE_MIN_WIDTH : 0;
    return `minmax(0, 1fr) minmax(${pageMin}px, ${PAGE_WIDTH}px) minmax(${gutter}px, 1fr)`;
  };

  const highlightStyles = createCommentHighlights(
    comments,
    () => !!props.commentRoots
  );

  onMount(() => {
    const root = editorRoot();
    if (!root) return;
    handle
      .mount(root)
      .then(() => {
        setLoading(false);
        props.onReady?.(handle);
      })
      .catch((error: unknown) => {
        setLoading(false);
        props.onError?.(error);
      });
  });

  const paragraphStyles = createMemo<DocxParagraphStyle[]>(() => {
    handle.revision();
    const current = editor();
    if (!current) return [];
    const byName = new Map(
      current
        .styles()
        .filter((style) => style.type === 'paragraph')
        .map((style) => [style.name.toLowerCase(), style])
    );
    return PREFERRED_STYLES.flatMap((name) => {
      const style = byName.get(name.toLowerCase());
      return style ? [{ id: style.id, name }] : [];
    });
  });

  const refreshFormat = () => {
    const current = editor();
    if (!current) return;
    try {
      setFormat(current.queryFormatState());
      setParagraphStyle(current.styleAtCaret());
    } catch {
      // The caret is outside an editable block.
    }
  };

  // Publish this user's caret and keep the toolbar state current.
  createEffect(() => {
    const root = editorRoot();
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshFormat();
        const selection = window.getSelection();
        const node = selection?.focusNode;
        const block = node ? blockOf(node, root) : null;
        const id = block?.getAttribute('data-anchor');
        props.onSelection?.(
          block && id && node
            ? {
                block: id,
                offset: contentOffset(block, node, selection!.focusOffset),
              }
            : undefined
        );
      }, 80);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
    });
  });

  const beginComment = () => {
    if (!comments.beginDraft())
      props.onError?.(new Error('Select text to comment on.'));
  };

  createEffect(() => {
    const root = editorRoot();
    if (!root || !props.commentRoots) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.code === 'KeyM'
      ) {
        event.preventDefault();
        beginComment();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    onCleanup(() => root.removeEventListener('keydown', onKeyDown));
  });

  const run = (
    command: (instance: NonNullable<ReturnType<typeof editor>>) => void
  ) => {
    const current = editor();
    if (!current) return;
    try {
      command(current);
    } catch (error) {
      props.onError?.(error);
    }
    refreshFormat();
  };

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col">
      {/* A DOCX is authored for paper: its runs carry their own colours, so
          the sheet stays white whatever the app theme is. */}
      <style>{`.docx-paper { background: #fff; color: #000; }
.docx-paper .docx-hf-band { padding: 10px 1in; }
.docx-paper .docx-hf-band[data-hf-band='header'] { border-bottom: 1px dashed #e5e7eb; }
.docx-paper .docx-hf-band[data-hf-band='footer'] { border-top: 1px dashed #e5e7eb; }
.docx-paper .docx-hf-placeholder { font: 12px/1.5 var(--font-sans, sans-serif); color: #9ca3af; }
.docx-paper .docx-hf-tag { margin-bottom: 2px; font: 500 10px/1.4 var(--font-sans, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; color: #9ca3af; }
${highlightStyles}`}</style>
      <DocxToolbar
        canEdit={props.canEdit}
        canComment={!!props.commentRoots && props.canComment()}
        format={format()}
        paragraphStyle={paragraphStyle()}
        paragraphStyles={paragraphStyles()}
        trackChanges={trackChanges()}
        onFormat={(key) => run((instance) => instance.format(key))}
        onParagraphStyle={(id) =>
          run((instance) => instance.setParagraphStyle(id))
        }
        onList={(kind) => run((instance) => instance.toggleList(kind))}
        onAlign={(alignment: DocxAlignment) =>
          run((instance) => instance.setAlignment(alignment))
        }
        onUndo={() => run(() => handle.undo())}
        onRedo={() => run(() => handle.redo())}
        onInsertTable={() => run((instance) => instance.insertTable(3, 3))}
        onToggleTrackChanges={() =>
          run((instance) => {
            const next = !trackChanges();
            instance.setTrackedChanges(
              next
                ? props.runtime.module.TrackedChangeMode.RenderInline
                : props.runtime.module.TrackedChangeMode.Accept
            );
            setTrackChanges(next);
          })
        }
        onComment={beginComment}
        onDownload={() => {
          handle.flush();
          const bytes = handle.save();
          if (bytes) props.onDownload(bytes);
        }}
      />
      <div
        ref={scroller}
        class="relative min-h-0 flex-1 overflow-auto bg-panel"
        data-docx-scroller
      >
        {/* The page sits centered between equal gutters. The page column
            shrinks so Docxodus zooms the sheet to fit a narrow split instead
            of scrolling it sideways, unless comment cards need the room. */}
        <div
          class="relative grid gap-x-2 px-4 pt-6 pb-24"
          style={{ 'grid-template-columns': pageColumns() }}
        >
          <div ref={page} class="relative col-start-2 min-w-0" data-docx-page>
            <div ref={setEditorRoot} class="docx-paper rounded-sm shadow-md" />
            <DocxCollaboratorCarets
              peers={props.peers()}
              editorRoot={editorRoot()}
              overlay={page}
              revision={handle.revision}
              displayName={props.displayName}
            />
            <Show when={loading()}>
              <div class="absolute inset-0 flex items-start justify-center pt-24 text-sm text-ink-muted">
                Opening document…
              </div>
            </Show>
          </div>
          <Show when={props.margin}>
            {(renderMargin) => (
              <div
                ref={setMargin}
                class="relative col-start-3 min-w-0"
                data-docx-margin
              >
                {renderMargin()({
                  comments,
                  get editorRoot() {
                    return editorRoot();
                  },
                  get margin() {
                    return margin();
                  },
                  revision: handle.revision,
                })}
              </div>
            )}
          </Show>
        </div>
        <Show when={props.footer}>
          {(renderFooter) => (
            <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-16">
              {renderFooter()(comments)}
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
