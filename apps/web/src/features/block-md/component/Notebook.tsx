import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { CommentMargin } from '@block-md/comments/CommentMargin';
import {
  commentsStore,
  commentWidthSignal,
} from '@block-md/comments/commentStore';
import { useGoToTempRedirect } from '@block-md/signal/location';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { SidePanel } from '@components/app/side-panel';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockAliasedName, useBlockId } from '@core/block';
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
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { tempRedirectLocation } from '@core/signal/location';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
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
import { useHistory } from '../history/HistoryContext';
import { HistoryOverlay } from '../history/HistoryOverlay';
import { DispatchAgentButton } from './DispatchAgentMenu';
import { DocumentAiEditBar } from './DocumentAiEditBar';
import { DocumentDiscussion } from './DocumentDiscussion';
import { InlineTaskGithubPullRequests } from './InlineTaskGithubPullRequests';
import { InlineTaskProperties } from './InlineTaskProperties';
import { InstructionsEditor } from './InstructionsEditor';
import { MarkdownEditor } from './MarkdownEditor';
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

const BreaksPoints: Record<CommentLayoutMode, number> = {
  lg: NoteTargetWidth + 2 * CommentTargetWidth + 3 * GapTargetWidth,
  md: (3 / 4) * NoteTargetWidth + CommentTargetWidth + GapTargetWidth,
  xs: 0,
  none: 0,
};

const widthToMode = (width: number): CommentLayoutMode => {
  if (width >= BreaksPoints.lg) return CommentLayoutMode.lg;
  if (width >= BreaksPoints.md) return CommentLayoutMode.md;
  if (width >= BreaksPoints.xs) return CommentLayoutMode.xs;
  return CommentLayoutMode.none;
};

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
}) {
  const blockElement = blockElementSignal.get;
  const blockId = useBlockId();
  const blockAliasedName = useBlockAliasedName();
  const setStore = mdStore.set;
  const setWideEnoughForComments = commentWidthSignal.set;
  const documentName = useBlockDocumentName();
  const scopeId = blockHotkeyScopeSignal.get;
  const md = mdStore.get;
  const history = useHistory();
  const { navigatedFromJK } = useNavigatedFromJK();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const documentId = props.documentId;
  const canEdit = useCanEdit();
  const inlineAiEditing = useFeatureFlag(enableInlineAiEditing);

  let notebookRef!: HTMLDivElement;
  let commentMarginRef: HTMLDivElement | undefined;
  let contentRef!: HTMLDivElement;
  // Escape the notebook's isolated stacking context so the menu covers editor
  // handles, while remaining inside the block so app chrome still covers it.
  const outlinePortalMount = () =>
    notebookRef.closest<HTMLElement>('.portal-scope') ?? notebookRef;

  const [layoutMode, setLayoutMode] = createSignal(CommentLayoutMode.none);
  const [width, setWidth] = createSignal(0);
  const [leftFloatX, setLeftFloatX] = createSignal(0);
  const canUseLexicalStateDebugger = useCanUseLexicalStateDebugger();
  const outline = useMarkdownOutline({
    editor: () => md.editor,
    enabled: () =>
      width() >= OutlineMinWidth && !history.isOpen() && !isMobile(),
  });

  const comments = commentsStore.get;
  const hasComment = createMemo(() => {
    if (!ENABLE_MARKDOWN_COMMENTS) return false;
    return Object.keys(comments).length > 0;
  });
  // On phones the margin is hidden entirely (no minimized rail); the touch
  // comment drawer is the only comment surface. CommentMargin stays mounted
  // inside the hidden wrapper — it hosts the drawer.
  const showComments = () => hasComment() && !history.isOpen() && !isMobile();

  const currentEditorState = () => {
    const editor = md.editor;
    return editor ? getSaveState(editor.getEditorState()) : undefined;
  };

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
      const mode = showComments() ? widthToMode(width) : CommentLayoutMode.none;
      setLayoutMode(mode);
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
    if (!showComments()) {
      setLayoutMode(CommentLayoutMode.none);
    } else {
      setLayoutMode(widthToMode(untrack(width)));
    }
  });

  createEffect(() => {
    if (showComments()) {
      setWideEnoughForComments(width() >= BreaksPoints.md);
    } else {
      setWideEnoughForComments(false);
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
      registerMarkdownCommands(scopeId(), () => md.editor, editorHasFocus, {
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

  // Wait for the block element before claiming focus on initial mount.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!canAutofocusSplitContent) return;
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
        <SidePanel.Section
          id="document-ai-actions"
          title="Actions"
          defaultOpen
          order={0}
        >
          <div class="m-px flex items-center justify-start gap-2">
            <AskMacroButton
              entity={{
                type: 'document',
                id: blockId,
                name: documentName(),
                fileType: 'md',
              }}
            />
            <Show when={blockAliasedName === 'task' && !isMobile()}>
              <DispatchAgentButton showPrimaryLabel />
            </Show>
          </div>
        </SidePanel.Section>
        <TitleEditor
          autoFocusOnMount={canAutofocusSplitContent && !navigatedFromJK()}
        />
        <div class="spacer h-3" />
        <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
          <InlineTaskProperties />
          <InlineTaskGithubPullRequests />
          <TaskDuplicateMatchPill />
        </div>
        <ParamsProvider>
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
        <CommentMargin />
      </div>
    </div>
  );
}

export function InstructionsNotebook(props: { loroManager: LoroManager }) {
  const setStore = mdStore.set;
  const scopeId = blockHotkeyScopeSignal.get;
  const canUseLexicalStateDebugger = useCanUseLexicalStateDebugger();

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

  createEffect(() => {
    if (!scopeId()) return;
    const group = untrack(() =>
      registerLexicalStateDebuggerCommand(scopeId(), {
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
