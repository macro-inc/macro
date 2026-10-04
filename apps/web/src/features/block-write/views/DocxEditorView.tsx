import type { Pos } from '@core/docx-engine/types';
import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  type DocxAlignment,
  type DocxParagraphStyle,
  DocxToolbar,
} from '../components/DocxToolbar';
import {
  createDocxComments,
  type DocxComments,
} from '../primitives/create-docx-comments';
import {
  createDocxEditor,
  type DocxEditor,
  PX_PER_PT,
} from '../primitives/create-docx-editor';
import type { DocxPeer, DocxSelection } from '../queries/docx-session';
import { DocxCollaboratorCarets } from './DocxCollaborators';
import {
  DocxPages,
  type PageGeometry,
  pageGeometry,
  toColumn,
} from './DocxPages';

/** Room for a comment card (280px) and its inset beside the page. */
const MARGIN_WIDTH = 296;
/** Horizontal padding around the pages. */
const SIDE_PADDING = 32;

export type DocxMarginContext = {
  comments: DocxComments;
  geometry: Accessor<PageGeometry>;
  /** Top of the selected text, when there is a selection to comment on. */
  selectionTop: Accessor<number | null>;
};

export type DocxEditorViewProps = {
  /** Collaborative document, or null for a read-only original. */
  doc: LoroDoc | null;
  original?: Uint8Array;
  canEdit: boolean;
  canComment: Accessor<boolean>;
  fileName: string;
  peers: Accessor<DocxPeer[]>;
  displayName: (userId: string | undefined) => string;
  onSelection?: (selection: DocxSelection | undefined) => void;
  /** Comment roots for this document; omit to disable commenting. */
  commentRoots?: Accessor<MessageListItem[]>;
  /** Margin content (comment threads) laid out beside the page. */
  margin?: (context: DocxMarginContext) => JSX.Element;
  /** Content below the page (discussion, detached comments). */
  footer?: (comments: DocxComments) => JSX.Element;
  onDownload: (bytes: Uint8Array) => void;
  onError?: (error: unknown) => void;
  /** Test hook: the mounted editor. */
  onReady?: (editor: DocxEditor) => void;
};

/** The collaborative DOCX editor: toolbar, pages, collaborators and comments. */
export function DocxEditorView(props: DocxEditorViewProps) {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  let input: HTMLTextAreaElement | undefined;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;

  const editor = createDocxEditor({
    doc: props.doc,
    original: props.original,
    editable: props.canEdit,
    onError: props.onError,
    onSelection: (selection) => {
      // Presence updates are throttled; the caret moves with every key.
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(
        () =>
          props.onSelection?.(
            selection
              ? {
                  block: selection.focus.block,
                  offset: selection.focus.offset,
                }
              : undefined
          ),
        80
      );
    },
  });
  onCleanup(() => clearTimeout(selectionTimer));

  createEffect(() => {
    if (editor.ready()) props.onReady?.(editor);
  });

  const geometry = pageGeometry(editor);

  const comments = createDocxComments({
    doc: props.doc,
    roots: () => props.commentRoots?.() ?? [],
    geometry: {
      revision: editor.revision,
      paragraphs: editor.paragraphs,
      rangeRects: editor.rangeRects,
      selection: () => editor.state()?.range,
    },
    canEdit: () => props.canEdit,
  });

  // Fit the pages to the width available, never above 100%.
  createEffect(() => {
    const element = scroller();
    if (!element) return;
    const fit = () => {
      const pages = editor.pages();
      if (!pages.length) return;
      const widest = Math.max(...pages.map((p) => p.width)) * PX_PER_PT;
      const gutter = props.margin ? MARGIN_WIDTH : 48;
      const available = element.clientWidth - SIDE_PADDING * 2 - gutter;
      editor.setZoom(Math.min(1, Math.max(0.3, available / widest)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    onCleanup(() => observer.disconnect());
  });

  const selectionTop = createMemo<number | null>(() => {
    const first = editor.state()?.rects[0];
    if (!first) return null;
    return toColumn(geometry(), first)?.top ?? null;
  });

  const paragraphStyles = createMemo<DocxParagraphStyle[]>(() => {
    const all = editor.styles();
    const quick = all.filter((s) => s.quick);
    const current = editor.state()?.format.style;
    const shown = quick.length ? quick : all.slice(0, 12);
    const list = shown.map((s) => ({ id: s.id, name: s.name }));
    const extra = current && all.find((s) => s.id === current);
    if (extra && !list.some((s) => s.id === extra.id))
      list.push({ id: extra.id, name: extra.name });
    return list;
  });

  const beginComment = () => {
    if (!comments.beginDraft())
      props.onError?.(new Error('Select text to comment on.'));
  };

  const onTextClick = (pos: Pos) => {
    if (!props.commentRoots) return;
    const hit = comments.threadAt(pos);
    if (hit) comments.setActive(hit);
    else if (!comments.draft()) comments.setActive(null);
  };

  const format = () => editor.state()?.format;

  const commentHighlights = (g: Accessor<PageGeometry>) => (
    <Show when={props.commentRoots}>
      <For each={comments.located()}>
        {(thread) => (
          <For each={thread.rects}>
            {(rect) => {
              const box = () => toColumn(g(), rect);
              return (
                <Show when={box()}>
                  {(b) => (
                    <div
                      class="absolute"
                      classList={{
                        'docx-comment': comments.active() !== thread.id,
                        'docx-comment-active': comments.active() === thread.id,
                        hidden:
                          thread.resolved && comments.active() !== thread.id,
                      }}
                      data-docx-comment-highlight={thread.id}
                      style={{
                        left: `${b().left}px`,
                        top: `${b().top}px`,
                        width: `${b().width}px`,
                        height: `${b().height}px`,
                      }}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        )}
      </For>
    </Show>
  );

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col">
      {/* A DOCX is authored for paper: the engine draws white sheets with the
          document's own colours whatever the app theme is. */}
      <style>{`.docx-sheet { background: #fff; }
.docx-selection { background-color: oklch(from var(--color-accent, #3b82f6) l c h / 0.28); }
.docx-caret { background-color: #000; animation: docx-blink 1.06s steps(1) infinite; }
@keyframes docx-blink { 50% { opacity: 0; } }
.docx-composition { background: #fff; color: #000; text-decoration: underline; }
.docx-comment { background-color: oklch(from var(--color-yellow) l c h / 0.28); border-bottom: 2px solid oklch(from var(--color-yellow) l c h / 0.7); }
.docx-comment-active { background-color: oklch(from var(--color-yellow) l c h / 0.55); border-bottom: 2px solid oklch(from var(--color-yellow) l c h / 0.9); }`}</style>
      <DocxToolbar
        canEdit={props.canEdit}
        canComment={!!props.commentRoots && props.canComment()}
        format={{
          bold: format()?.bold,
          italic: format()?.italic,
          underline: format()?.underline,
          strike: format()?.strike,
        }}
        fontSize={format()?.size ?? null}
        paragraphStyle={format()?.style ?? null}
        paragraphStyles={paragraphStyles()}
        showMarkup={editor.markup()}
        onFormat={(key) => {
          editor.run([{ op: 'toggleFormat', format: key }]);
          input?.focus();
        }}
        onFontSize={(size) => {
          editor.run([{ op: 'setFormat', size }]);
          input?.focus();
        }}
        onParagraphStyle={(id) => {
          if (id) editor.run([{ op: 'setStyle', style: id }]);
          input?.focus();
        }}
        onList={(kind) => {
          editor.run([{ op: 'toggleList', kind }]);
          input?.focus();
        }}
        onAlign={(alignment: DocxAlignment) => {
          editor.run([{ op: 'setParagraph', align: alignment }]);
          input?.focus();
        }}
        onUndo={() => void editor.undo()}
        onRedo={() => void editor.redo()}
        onInsertTable={() => {
          editor.run([{ op: 'insertTable', rows: 3, cols: 3 }]);
          input?.focus();
        }}
        onToggleMarkup={() => void editor.setMarkup(!editor.markup())}
        onComment={beginComment}
        onDownload={() => {
          editor
            .idle()
            .then(() => editor.save())
            .then(props.onDownload)
            .catch((error: unknown) => props.onError?.(error));
        }}
      />
      <div
        ref={setScroller}
        class="relative min-h-0 flex-1 overflow-auto bg-panel"
        data-docx-scroller
      >
        <div
          class="relative grid gap-x-2 pt-6 pb-24"
          style={{
            'grid-template-columns': `minmax(${SIDE_PADDING}px, 1fr) ${geometry().width}px minmax(${
              props.margin ? MARGIN_WIDTH : 48
            }px, 1fr)`,
          }}
        >
          <div class="relative col-start-2 min-w-0">
            <DocxPages
              editor={editor}
              scroller={scroller()}
              editable={props.canEdit}
              onTextClick={onTextClick}
              onComment={props.commentRoots ? beginComment : undefined}
              inputRef={(el) => {
                input = el;
              }}
              overlay={(g) => (
                <>
                  {commentHighlights(g)}
                  <DocxCollaboratorCarets
                    peers={props.peers()}
                    geometry={g}
                    revision={editor.revision}
                    caretAt={editor.caretAt}
                    displayName={props.displayName}
                  />
                </>
              )}
            />
            <Show when={!editor.ready()}>
              <div class="absolute inset-x-0 top-24 flex justify-center text-sm text-ink-muted">
                Opening document…
              </div>
            </Show>
          </div>
          <Show when={props.margin}>
            {(renderMargin) => (
              <div class="relative col-start-3 min-w-0" data-docx-margin>
                {renderMargin()({ comments, geometry, selectionTop })}
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
