import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { CommentMargin } from '@block-md/comments/CommentMargin';
import { useGoToTempRedirect } from '@block-md/signal/location';
import {
  editorFocusSignal,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { ParamsProvider } from '@core/component/ParamsProvider';
import {
  DEV_MODE_ENV,
  ENABLE_MARKDOWN_COMMENTS,
  enableHistoryComponent,
  enableInlineAiEditing,
  isFeatureEnabled,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { useIsMacroTeam } from '@core/context/team';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { tempRedirectLocation } from '@core/signal/location';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { makePersisted } from '@solid-primitives/storage';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useHistory } from '../history/HistoryContext';
import { HistoryOverlay } from '../history/HistoryOverlay';
import { DocumentAiEditBar } from './DocumentAiEditBar';
import { DocumentDiscussion } from './DocumentDiscussion';
import { InlineTaskGithubPullRequests } from './InlineTaskGithubPullRequests';
import { InlineTaskProperties } from './InlineTaskProperties';
import { InstructionsEditor } from './InstructionsEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { useMarkdownName } from './MarkdownNameProvider';
import {
  MARKDOWN_OUTLINE_WIDTH,
  MarkdownOutline,
  useMarkdownOutline,
} from './MarkdownOutline';
import { TaskDuplicateMatchPill } from './TaskDuplicateMatches';
import { TitleEditor } from './TitleEditor';
import {
  registerLexicalStateDebuggerCommand,
  registerMarkdownCommands,
} from './useMarkdownCommands';

/**
 * Whether the Lexical state debugger panel is open, persisted across reloads so
 * the debug panel stays where the user left it. Shared by every notebook so the
 * toggle is consistent regardless of which editor surfaced it.
 */
const [showLexicalStateDebugger, setShowLexicalStateDebugger] = makePersisted(
  createSignal(false),
  { name: 'lexical-state-debugger-open' }
);

const NoteTargetWidth = 768;
const CommentTargetWidth = 320;
const GapTargetWidth = 24;
const MinimizedCommentTargetWidth = 48;
const OutlineEdgeInset = 16;
const OutlineMinWidth =
  NoteTargetWidth + 2 * (MARKDOWN_OUTLINE_WIDTH + OutlineEdgeInset);

enum CommentLayoutMode {
  lg = 'lg',
  md = 'md',
  xs = 'xs',
  none = 'none',
}

const CommentBreakpoints = {
  lg: {
    min: NoteTargetWidth + 2 * CommentTargetWidth + 3 * GapTargetWidth,
  },
  md: {
    min: (3 / 4) * NoteTargetWidth + CommentTargetWidth + GapTargetWidth,
  },
} as const;

function useCanUseLexicalStateDebugger() {
  const isMacroTeam = useIsMacroTeam();
  return createMemo(() => {
    if (LOCAL_ONLY || DEV_MODE_ENV) return true;
    return isMacroTeam();
  });
}

export function Notebook(props: {
  loroManager: LoroManager;
  documentId: string;
  hotkeyScope: string | undefined;
  autoFocus: boolean;
}) {
  const { element: blockElement, permissions, state } = useMarkdownDocument();
  const canEdit = permissions.canEdit;
  const { comments: commentState, params } = state;
  const { md, setMd } = state.editor;
  const { displayName: documentName } = useMarkdownName();
  const scopeId = () => props.hotkeyScope;
  const history = useHistory();
  const documentId = props.documentId;
  const inlineAiEditing = useFeatureFlag(enableInlineAiEditing);

  let notebookRef!: HTMLDivElement;
  let commentMarginRef: HTMLDivElement | undefined;
  let contentRef!: HTMLDivElement;
  // Escape the notebook's isolated stacking context so the menu covers editor
  // handles, while remaining inside the block so app chrome still covers it.
  const outlinePortalMount = () =>
    notebookRef.closest<HTMLElement>('.portal-scope') ?? notebookRef;

  const [width, setWidth] = createSignal<number>();
  const [leftFloatX, setLeftFloatX] = createSignal(0);
  const commentBreakpoints = createSizeBreakpoints(width, CommentBreakpoints);
  const canUseLexicalStateDebugger = useCanUseLexicalStateDebugger();
  const outline = useMarkdownOutline({
    editor: () => md.editor,
    enabled: () =>
      (width() ?? 0) >= OutlineMinWidth && !history.isOpen() && !isMobile(),
  });

  const hasComment = createMemo(() => {
    if (!ENABLE_MARKDOWN_COMMENTS) return false;
    return Object.keys(commentState.comments).length > 0;
  });
  // On phones the margin is hidden entirely (no minimized rail); the touch
  // comment drawer is the only comment surface. CommentMargin stays mounted
  // inside the hidden wrapper — it hosts the drawer.
  const showComments = () => hasComment() && !history.isOpen() && !isMobile();
  const layoutMode = (): CommentLayoutMode => {
    if (!showComments() || width() === undefined) {
      return CommentLayoutMode.none;
    }
    if (commentBreakpoints.lg()) return CommentLayoutMode.lg;
    if (commentBreakpoints.md()) return CommentLayoutMode.md;
    return CommentLayoutMode.xs;
  };

  const currentEditorState = () => {
    const editor = md.editor;
    return editor ? getSaveState(editor.getEditorState()) : undefined;
  };

  // Set the refs on the block store.
  onMount(() => {
    setMd({
      notebook: notebookRef,
      commentMargin: commentMarginRef,
      contentRef: contentRef,
    });
    onCleanup(() => {
      setMd({ notebook: undefined, commentMargin: undefined });
    });

    const observeCallback = () => {
      const { width, left } = notebookRef.getBoundingClientRect();
      setWidth(width);
      const leftFloat =
        contentRef.getBoundingClientRect().right - left + GapTargetWidth;
      setLeftFloatX(leftFloat);
    };
    const { observe } = makeResizeObserver(observeCallback);
    observeCallback();
    observe(notebookRef);
  });

  // Component scope on purpose: the hook registers an onCleanup that ends
  // its pending wait-for-mark. Called inside the createEffect below, that
  // cleanup would belong to the effect's computation and run on every
  // re-run — tying the deep-link scroll's lifetime to re-run ordering.
  const goToTempRedirect = useGoToTempRedirect();

  createEffect(() => {
    const recentState = tempRedirectLocation();
    if (!recentState) return;

    setTimeout(() => {
      goToTempRedirect(documentId, recentState);
    }, 0);
  });

  createEffect(() => {
    const currentScopeId = scopeId();
    if (!currentScopeId) return;
    untrack(() =>
      registerHotkey({
        hotkey: 'enter',
        scopeId: currentScopeId,
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
    const currentScopeId = scopeId();
    if (!currentScopeId) return;
    const group = untrack(() =>
      registerMarkdownCommands(
        currentScopeId,
        () => md.editor,
        editorHasFocus,
        {
          canUseStateDebugger: canUseLexicalStateDebugger,
          toggleStateDebugger: () =>
            setShowLexicalStateDebugger((prev) => !prev),
        }
      )
    );
    onCleanup(() => group.dispose());
  });
  createEffect(() => {
    if (!canUseLexicalStateDebugger() && showLexicalStateDebugger()) {
      setShowLexicalStateDebugger(false);
    }
  });

  // Wait for the block element before claiming focus on initial mount.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!props.autoFocus) return;
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
        return `${shared} px-8 gap-6 justify-center`;
      case CommentLayoutMode.xs:
        return `${shared} px-6 gap-6 justify-center`;
      default:
        return `${shared} px-6`;
    }
  });

  const contentDivClasses = createMemo(() => {
    const mode = layoutMode();
    const shared = 'grow max-w-3xl pt-12 touch:pt-6 min-w-0';
    switch (mode) {
      case CommentLayoutMode.lg:
        return `${shared} mx-auto`;
      case CommentLayoutMode.md:
        return `${shared} flex-3`;
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
      case CommentLayoutMode.xs:
        return {
          classes: 'flex-1 min-w-0 shrink-0 pointer-events-none',
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
      <Show when={outline.show()}>
        <div
          class="pointer-events-none absolute inset-y-0 z-1"
          style={{
            left: `${OutlineEdgeInset}px`,
            width: `${MARKDOWN_OUTLINE_WIDTH}px`,
          }}
        >
          <MarkdownOutline
            editor={() => md.editor}
            outline={outline}
            portalMount={outlinePortalMount}
            scrollContainer={() => md.scrollContainer}
          />
        </div>
      </Show>
      <div
        class={contentDivClasses()}
        ref={contentRef}
        classList={{ relative: true }}
      >
        <TitleEditor autoFocusOnMount={props.autoFocus} />
        <div class="spacer h-3" />
        <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
          <InlineTaskProperties />
          <InlineTaskGithubPullRequests />
          <TaskDuplicateMatchPill />
        </div>
        <ParamsProvider state={params}>
          {/* Relative wrapper so the history overlay covers only the body region,
              leaving the title + properties above it untouched and aligned. */}
          <div class="relative">
            <MarkdownEditor
              loroManager={props.loroManager}
              showLexicalStateDebugger={
                canUseLexicalStateDebugger() && showLexicalStateDebugger()
              }
              onLexicalStateDebuggerClose={() =>
                setShowLexicalStateDebugger(false)
              }
            />
            <Show when={isFeatureEnabled(enableHistoryComponent)}>
              <HistoryOverlay
                currentState={currentEditorState}
                selectedAt={history.selectedAt()}
                isLive={history.isLive()}
                visible={history.isOpen()}
                onExit={history.exit}
              />
            </Show>
          </div>
          <Show when={!history.isOpen()}>
            <Show when={inlineAiEditing().enabled && canEdit() && !isMobile()}>
              <div class="mb-2">
                <DocumentAiEditBar documentId={props.documentId} />
              </div>
            </Show>
            <DocumentDiscussion />
          </Show>
        </ParamsProvider>
      </div>
      <div
        class={commentPositioning().classes}
        style={{
          ...commentPositioning().style,
          ...(layoutMode() === CommentLayoutMode.xs
            ? {
                width: `${MinimizedCommentTargetWidth}px`,
                'max-width': `${MinimizedCommentTargetWidth}px`,
              }
            : {}),
        }}
        ref={commentMarginRef}
        classList={{
          block: showComments(),
          hidden: !showComments(),
        }}
      >
        <CommentMargin
          wideEnough={showComments() && commentBreakpoints.md()}
        />
      </div>
    </div>
  );
}

export function InstructionsNotebook(props: {
  loroManager: LoroManager;
  hotkeyScope: string | undefined;
}) {
  const { state } = useMarkdownDocument();
  const setMd = state.editor.setMd;
  const scopeId = () => props.hotkeyScope;
  const canUseLexicalStateDebugger = useCanUseLexicalStateDebugger();

  let notebookRef!: HTMLDivElement;
  let contentRef!: HTMLDivElement;

  // Set the refs on the block store.
  onMount(() => {
    setMd({
      notebook: notebookRef,
      commentMargin: undefined,
      contentRef: contentRef,
    });
    onCleanup(() => {
      setMd({
        notebook: undefined,
        commentMargin: undefined,
      });
    });
  });

  createEffect(() => {
    const currentScopeId = scopeId();
    if (!currentScopeId) return;
    const group = untrack(() =>
      registerLexicalStateDebuggerCommand(currentScopeId, {
        canUseStateDebugger: canUseLexicalStateDebugger,
        toggleStateDebugger: () => setShowLexicalStateDebugger((prev) => !prev),
      })
    );
    onCleanup(() => group.dispose());
  });
  createEffect(() => {
    if (!canUseLexicalStateDebugger() && showLexicalStateDebugger()) {
      setShowLexicalStateDebugger(false);
    }
  });

  return (
    <div
      class="flex relative text-ink min-h-full min-w-0 px-6"
      ref={notebookRef}
    >
      <div class="grow max-w-3xl pt-12 min-w-0 mx-auto" ref={contentRef}>
        <InstructionsEditor
          loroManager={props.loroManager}
          showLexicalStateDebugger={
            canUseLexicalStateDebugger() && showLexicalStateDebugger()
          }
          onLexicalStateDebuggerClose={() => setShowLexicalStateDebugger(false)}
        />
      </div>
    </div>
  );
}
