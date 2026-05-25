import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import { CommentMargin } from '@block-md/comments/CommentMargin';
import {
  commentsStore,
  commentWidthSignal,
} from '@block-md/comments/commentStore';
import { useGoToTempRedirect } from '@block-md/signal/location';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { editorFocusSignal } from '@core/component/LexicalMarkdown/utils';
import { ParamsProvider } from '@core/component/ParamsProvider';
import {
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_RAIL_CHAT_TASK_COMMENTS,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { tempRedirectLocation } from '@core/signal/location';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
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
import { InlineTaskGithubPullRequests } from './InlineTaskGithubPullRequests';
import { InlineTaskProperties } from './InlineTaskProperties';
import { InstructionsEditor } from './InstructionsEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { TaskDiscussion } from './TaskDiscussion';
import { TitleEditor } from './TitleEditor';
import { registerMarkdownCommands } from './useMarkdownCommands';

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
  // hardcoded value below accounts for extra padding at sm size, keeps it from getting too squished
  sm: NoteTargetWidth - 2 * GapTargetWidth + 260,
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
  const documentName = useBlockDocumentName();
  const scopeId = blockHotkeyScopeSignal.get;
  const isTask = useBlockAliasedName() === 'task';
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
      const mode = hasComment() ? widthToMode(width) : CommentLayoutMode.none;
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
    if (!scopeId()) return;
    untrack(() =>
      registerHotkey({
        hotkey: 'enter',
        scopeId: scopeId(),
        hotkeyToken: TOKENS.block.focus,
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
      })
    );
  });

  // Register markdown formatting commands on the block scope so they appear in
  // Cmd+K, but only when the editor has focus (not just the block container).
  const [editorHasFocus, setEditorHasFocus] = createSignal(false);
  createEffect(() => {
    const editor = md.editor;
    if (!editor) return;
    const cleanup = editorFocusSignal(editor, setEditorHasFocus);
    onCleanup(cleanup);
  });
  createEffect(() => {
    if (!scopeId()) return;
    const group = untrack(() =>
      registerMarkdownCommands(scopeId(), () => md.editor, editorHasFocus)
    );
    onCleanup(() => group.dispose());
  });

  // In preview mode, switching between Soup tabs was causing this createEffect to overflow the stack. We should figure out that root cause, this flag fixes it for now.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!blockElement()) return;
    blockElement()?.focus();
    hasRun = true;
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
        <div class="spacer h-3" />
        <InlineTaskProperties />
        <InlineTaskGithubPullRequests />
        <ParamsProvider>
          <MarkdownEditor autoFocusOnMount={!navigatedFromJK()} />
          <Show when={ENABLE_RAIL_CHAT_TASK_COMMENTS && isTask}>
            <TaskDiscussion />
          </Show>
        </ParamsProvider>
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
        <InstructionsEditor />
      </div>
    </div>
  );
}
