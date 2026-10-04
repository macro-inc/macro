import type { EditOp, PageRect, Pos } from '@core/docx-engine/types';
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
import { match } from 'ts-pattern';
import { DocxFindBar } from '../components/DocxFindBar';
import {
  type DocxAlignment,
  type DocxParagraphStyle,
  type DocxTableOp,
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
import { createDocxFind } from '../primitives/create-docx-find';
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
  /** The name this person's tracked changes are recorded under. */
  author?: string;
  /** The document's id (for pasting copied content back losslessly). */
  documentId?: string;
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
    author: props.author,
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

  /** Scrolls a page rectangle into view (a third of the way down). */
  function reveal(rect: PageRect | undefined) {
    const element = scroller();
    const column = element?.querySelector<HTMLElement>('[data-docx-pages]');
    const box = rect && toColumn(geometry(), rect);
    if (!element || !column || !box) return;
    const top =
      column.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      element.scrollTop +
      box.top;
    const margin = 96;
    if (
      top < element.scrollTop + margin ||
      top + box.height > element.scrollTop + element.clientHeight - margin
    )
      element.scrollTop = Math.max(0, top - element.clientHeight / 3);
  }

  const find = createDocxFind({
    search: (query, options) => editor.find(query, options),
    selectedText: () => editor.selectedText(),
    revision: editor.revision,
    run: (ops) => editor.run(ops),
    reveal: (match) => reveal(match.rects[0]),
  });

  const closeFind = () => {
    find.close();
    input?.focus();
  };

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

  // Comments anchor in the body, not in headers, footers or notes.
  const selectionTop = createMemo<number | null>(() => {
    const state = editor.state();
    const first = state?.rects[0];
    if (!first || state.story.kind !== 'body') return null;
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

  /** Runs a toolbar command and returns focus to the document. */
  const command = (ops: EditOp[]) => {
    editor.run(ops);
    input?.focus();
  };

  const tableOp = (op: DocxTableOp): EditOp =>
    match(op)
      .with('rowAbove', (): EditOp => ({ op: 'insertRow', below: false }))
      .with('rowBelow', (): EditOp => ({ op: 'insertRow', below: true }))
      .with('columnLeft', (): EditOp => ({ op: 'insertColumn', right: false }))
      .with('columnRight', (): EditOp => ({ op: 'insertColumn', right: true }))
      .with('deleteRow', (): EditOp => ({ op: 'deleteRow' }))
      .with('deleteColumn', (): EditOp => ({ op: 'deleteColumn' }))
      .with('deleteTable', (): EditOp => ({ op: 'deleteTable' }))
      .exhaustive();

  /** At most this many matches are highlighted (the count shows them all). */
  const HIGHLIGHTED = 5000;

  const findHighlights = (g: Accessor<PageGeometry>) => (
    <Show when={find.open()}>
      <For each={find.matches().slice(0, HIGHLIGHTED)}>
        {(match, index) => (
          <For each={match.rects}>
            {(rect) => {
              const box = () => toColumn(g(), rect);
              return (
                <Show when={box()}>
                  {(b) => (
                    <div
                      class="absolute"
                      classList={{
                        'docx-find': index() !== find.current(),
                        'docx-find-current': index() === find.current(),
                      }}
                      data-docx-find-match={index()}
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
.docx-comment-active { background-color: oklch(from var(--color-yellow) l c h / 0.55); border-bottom: 2px solid oklch(from var(--color-yellow) l c h / 0.9); }
.docx-find { background-color: oklch(from var(--color-orange) l c h / 0.3); }
.docx-find-current { background-color: oklch(from var(--color-orange) l c h / 0.6); box-shadow: 0 0 0 1px oklch(from var(--color-orange) l c h / 0.9); }
.docx-veil { background: rgb(255 255 255 / 0.55); }
.docx-story-edge { border-color: oklch(from var(--color-accent, #3b82f6) l c h / 0.8); }`}</style>
      <DocxToolbar
        canEdit={props.canEdit}
        canComment={
          !!props.commentRoots &&
          props.canComment() &&
          editor.state()?.story.kind === 'body'
        }
        format={{
          bold: format()?.bold,
          italic: format()?.italic,
          underline: format()?.underline,
          strike: format()?.strike,
          superscript: format()?.superscript,
          subscript: format()?.subscript,
        }}
        fontSize={format()?.size ?? null}
        fontFamily={format()?.font ?? null}
        color={format()?.color ?? null}
        highlight={format()?.highlight ?? null}
        lineSpacing={format()?.lineSpacing ?? null}
        inTable={!!format()?.table}
        paragraphStyle={format()?.style ?? null}
        paragraphStyles={paragraphStyles()}
        showMarkup={editor.markup()}
        tracking={!!format()?.tracking}
        onRevision={!!format()?.revision}
        onFormat={(key) => {
          editor.run([{ op: 'toggleFormat', format: key }]);
          input?.focus();
        }}
        onFontSize={(size) => {
          editor.run([{ op: 'setFormat', size }]);
          input?.focus();
        }}
        onFontFamily={(font) => command([{ op: 'setFormat', font }])}
        onColor={(color) => command([{ op: 'setFormat', color }])}
        onHighlight={(highlight) => command([{ op: 'setFormat', highlight }])}
        onClearFormat={() => command([{ op: 'clearFormat' }])}
        onIndent={(forward) => command([{ op: 'indent', forward }])}
        onLineSpacing={(value) =>
          command([
            { op: 'setParagraph', lineSpacing: { rule: 'auto', value } },
          ])
        }
        onTable={(op) => command([tableOp(op)])}
        onRefocus={() => input?.focus()}
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
        onInsertNote={(endnote) => command([{ op: 'insertNote', endnote }])}
        inBody={editor.state()?.story.kind === 'body'}
        onToggleMarkup={() => void editor.setMarkup(!editor.markup())}
        onToggleTracking={() =>
          editor.run([{ op: 'setTracking', on: !format()?.tracking }])
        }
        onAccept={(all) => editor.run([{ op: 'acceptChanges', all }])}
        onReject={(all) => editor.run([{ op: 'rejectChanges', all }])}
        onComment={beginComment}
        onFind={() => find.show(false)}
        onDownload={() => {
          editor
            .idle()
            .then(() => editor.save())
            .then(props.onDownload)
            .catch((error: unknown) => props.onError?.(error));
        }}
      />
      <div class="relative flex min-h-0 flex-1 flex-col">
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
                documentId={props.documentId}
                onTextClick={onTextClick}
                onComment={props.commentRoots ? beginComment : undefined}
                onFind={(replace) => find.show(replace && props.canEdit)}
                onFindNext={(forward) => {
                  if (!find.open()) return;
                  if (forward) find.next();
                  else find.previous();
                }}
                inputRef={(el) => {
                  input = el;
                }}
                overlay={(g) => (
                  <>
                    {findHighlights(g)}
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
        <Show when={find.open()}>
          <div class="absolute top-2 right-4 z-10">
            <DocxFindBar
              query={find.query()}
              replacement={find.replacement()}
              matchCase={find.matchCase()}
              wholeWord={find.wholeWord()}
              count={find.matches().length}
              current={find.current()}
              truncated={find.truncated()}
              replaced={find.replaced()}
              replacing={find.replacing()}
              canEdit={props.canEdit}
              focusRequest={find.focusRequest()}
              onQuery={find.setQuery}
              onReplacement={find.setReplacement}
              onToggleMatchCase={find.toggleMatchCase}
              onToggleWholeWord={find.toggleWholeWord}
              onToggleReplace={() => find.setReplacing((v) => !v)}
              onNext={find.next}
              onPrevious={find.previous}
              onReplace={() => find.replace(props.canEdit)}
              onReplaceAll={() => find.replaceAll(props.canEdit)}
              onClose={closeFind}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
