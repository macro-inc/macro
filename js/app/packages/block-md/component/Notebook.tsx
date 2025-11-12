import { CommentMargin } from '@block-md/comments/CommentMargin';
import {
  commentsStore,
  commentWidthSignal,
  showCommentsPreference,
} from '@block-md/comments/commentStore';
import { useGoToTempRedirect } from '@block-md/signal/location';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { useBlockId } from '@core/block';
import {
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_PROPERTIES_METADATA,
} from '@core/constant/featureFlags';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { tempRedirectLocation } from '@core/signal/location';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { FrontMatterProperties } from './FrontMatterProperties';
import { InstructionsMarkdownEditor, MarkdownEditor } from './MarkdownEditor';
import { TitleEditor } from './TitleEditor';
import { useNavigatedFromJK } from '@app/component/SoupContext';

const NoteTargetWidth = 768;
const CommentTargetWidth = 320;
const GapTargetWidth = 36;

enum CommentLayoutMode {
  lg = 'lg',
  md = 'md',
  sm = 'sm',
  xs = 'xs',
  none = 'none',
}

const BreaksPoints: Record<CommentLayoutMode, number> = {
  lg: NoteTargetWidth + 2 * CommentTargetWidth + 3 * GapTargetWidth,
  md: NoteTargetWidth + CommentTargetWidth + 3 * GapTargetWidth,
  sm: NoteTargetWidth - 2 * GapTargetWidth,
  xs: 0,
  none: 0,
};

const widthToMode = (width: number): CommentLayoutMode => {
  if (width >= BreaksPoints.lg) return CommentLayoutMode.lg;
  if (width >= BreaksPoints.md) return CommentLayoutMode.md;
  if (width >= BreaksPoints.sm) return CommentLayoutMode.sm;
  if (width >= BreaksPoints.xs) return CommentLayoutMode.xs;
  return CommentLayoutMode.none;
};

export function Notebook() {
  const blockElement = blockElementSignal.get;
  const setStore = mdStore.set;
  const setWideEnoughForComments = commentWidthSignal.set;
  const canEdit = useCanEdit();
  const documentName = useBlockDocumentName();
  const scopeId = blockHotkeyScopeSignal.get;
  const md = mdStore.get;

  let notebookRef!: HTMLDivElement;
  let commentMarginRef: HTMLDivElement | undefined;
  let contentRef!: HTMLDivElement;

  const [layoutMode, setLayoutMode] = createSignal(CommentLayoutMode.none);
  const [width, setWidth] = createSignal(0);
  const [leftFloatX, setLeftFloatX] = createSignal(0);
  const { navigatedFromJK } = useNavigatedFromJK();

  const comments = commentsStore.get;
  const hasComment = createMemo(() => {
    if (!ENABLE_MARKDOWN_COMMENTS) return false;
    return Object.keys(comments).length > 0;
  });

  // Set the refs on the block store.
  onMount(() => {
    setStore({
      notebook: notebookRef,
      commentMargin: commentMarginRef,
      contentRef: contentRef,
    });
    onCleanup(() => {
      setStore({ notebook: undefined, commentMargin: undefined });
    });

    const observeCallback = () => {
      const { width, left } = notebookRef.getBoundingClientRect();
      setWidth(width);
      let mode = widthToMode(width);
      if (!hasComment()) {
        mode = CommentLayoutMode.none;
      } else if (!showCommentsPreference() && width > BreaksPoints.md) {
        mode = CommentLayoutMode.sm;
      }
      setLayoutMode(mode);
      const leftFloat =
        contentRef.getBoundingClientRect().right - left + GapTargetWidth;
      setLeftFloatX(leftFloat);
    };
    const { observe } = makeResizeObserver(observeCallback);
    observeCallback();
    observe(notebookRef);
  });

  createEffect(() => {
    const goToTempRedirect = useGoToTempRedirect();
    const documentId = useBlockId();
    const recentState = tempRedirectLocation();
    if (!documentId || !recentState) return;

    setTimeout(() => {
      goToTempRedirect(documentId, recentState);
    }, 0);
  });

  createEffect(() => {
    if (!hasComment()) {
      setLayoutMode(CommentLayoutMode.none);
    } else {
      setLayoutMode(widthToMode(untrack(width)));
    }
  });

  createEffect(() => {
    if (hasComment()) {
      setWideEnoughForComments(width() >= BreaksPoints.md);
    }
  });

  createEffect(() => {
    if (showCommentsPreference()) {
      setLayoutMode(widthToMode(untrack(width)));
    } else {
      if (untrack(width) >= BreaksPoints.sm) {
        setLayoutMode(CommentLayoutMode.sm);
      } else {
        setLayoutMode(CommentLayoutMode.xs);
      }
    }
  });

  createEffect(() => {
    if (scopeId()) {
      registerHotkey({
        hotkey: 'enter',
        scopeId: scopeId(),
        description: 'Focus Title or Markdown Editor',
        keyDownHandler: () => {
          const titleEditor = md.titleEditor;
          const markdownEditor = md.editor;
          const docName = untrack(documentName);

          if (titleEditor && docName === '') {
            titleEditor.focus();
            return true;
          } else if (markdownEditor) {
            markdownEditor.focus(undefined, { defaultSelection: 'rootStart' });
            return true;
          }
          return false;
        },
        hide: true,
      });
    }
  });

  createEffect(() => {
    if (!blockElement()) return;
    if (!navigatedFromJK()) return;
    blockElement()?.focus();
  });

  const containerClasses = createMemo(() => {
    const mode = layoutMode();
    const shared = 'flex relative text-ink min-h-full min-w-0 isolate';
    switch (mode) {
      case CommentLayoutMode.lg:
        return shared;
      case CommentLayoutMode.md:
        return `${shared} gap-9 justify-center`;
      case CommentLayoutMode.sm:
        return `${shared} px-36`;
      case CommentLayoutMode.xs:
        return `${shared} px-6 gap-9 justify-center`;
      default:
        return `${shared} px-6`;
    }
  });

  const contentDivClasses = createMemo(() => {
    const mode = layoutMode();
    const shared = 'grow max-w-3xl pt-12 min-w-0';
    switch (mode) {
      case CommentLayoutMode.lg:
        return `${shared} mx-auto`;
      case CommentLayoutMode.md:
        return `${shared} flex-3`;
      case CommentLayoutMode.sm:
        return `${shared} mx-auto`;
      case CommentLayoutMode.xs:
        return `${shared} flex-3`;
      default:
        return `${shared} mx-auto`;
    }
  });

  const commentPositioning = createMemo(() => {
    const mode = layoutMode();
    const leftFloat = leftFloatX();
    switch (mode) {
      case CommentLayoutMode.lg:
        return {
          classes: 'absolute top-0 h-full w-xs pointer-events-none',
          style: { left: `${leftFloat}px` },
        };
      case CommentLayoutMode.md:
        return {
          classes: 'flex-2 max-w-xs min-w-0 pointer-events-none',
          style: {},
        };
      case CommentLayoutMode.sm:
        return {
          classes: 'absolute top-0 h-full w-20 pointer-events-none',
          style: { left: `${leftFloat}px` },
        };
      case CommentLayoutMode.xs:
        return {
          classes: 'flex-1 max-w-6.5 min-w-0 shrink-0 pointer-events-none',
          style: { left: `${leftFloat}px` },
        };
      default:
        return {
          classes: 'hidden',
          style: {},
        };
    }
  });

  return (
    <div class={containerClasses()} ref={notebookRef}>
      <div class={contentDivClasses()} ref={contentRef}>
        <TitleEditor autoFocusOnMount={!navigatedFromJK()} />
        <Show
          when={ENABLE_PROPERTIES_METADATA}
          fallback={<div class="h-6 w-full" />}
        >
          <FrontMatterProperties
            canEdit={canEdit()}
            documentName={documentName()}
            fallback={<div class="h-6 w-full" />}
          />
        </Show>
        <MarkdownEditor autoFocusOnMount={!navigatedFromJK()} />
      </div>
      <div
        class={commentPositioning().classes}
        style={commentPositioning().style}
        ref={commentMarginRef}
        classList={{
          block: hasComment(),
          hidden: !hasComment(),
        }}
      >
        <CommentMargin />
      </div>
    </div>
  );
}

export function InstructionsNotebook() {
  const setStore = mdStore.set;

  let notebookRef!: HTMLDivElement;
  let contentRef!: HTMLDivElement;

  // Set the refs on the block store.
  onMount(() => {
    setStore({
      notebook: notebookRef,
      commentMargin: undefined,
      contentRef: contentRef,
    });
    onCleanup(() => {
      setStore({
        notebook: undefined,
        commentMargin: undefined,
      });
    });
  });

  return (
    <div
      class="flex relative text-ink min-h-full min-w-0 px-6"
      ref={notebookRef}
    >
      <div class="grow max-w-3xl pt-12 min-w-0 mx-auto" ref={contentRef}>
        <InstructionsMarkdownEditor />
      </div>
    </div>
  );
}
