import { startEditorScrollTelemetry } from '@app/observability/editor';
import { useFlow } from '@app/observability/flow';
import { NativeMessageCommentsProvider } from '@block-md/comments/NativeMessageCommentsProvider';
import { URL_PARAMS } from '@block-md/constants';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { HighlightLayerMount } from '@core/component/LexicalMarkdown/component/core/Highlights';
import { NativeLocationHighlight } from '@core/component/LexicalMarkdown/component/core/NativeLocationHighlight';
import { NodeAccessoryLayer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { FloatingEquationMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingEquationMenu';
import { HostedFloatingGifMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingGifMenu';
import {
  NativeChecklistFacts,
  NativeChecklistOverlay,
} from '@core/component/LexicalMarkdown/component/task-list/NativeTaskListControls';
import { DecoratorHostContext } from '@core/component/LexicalMarkdown/context/DecoratorHostContext';
import { allocateEditorNamespace } from '@core/component/LexicalMarkdown/context/editor-namespace';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { createNativeFastCachedDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-cached-views';
import { createNativeFastContactDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-contact-views';
import { createNativeFastHTMLDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-html-views';
import { createNativeFastSelectionDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-selection-views';
import { createNativeFastStaticDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-static-views';
import { createNativeAgentSessionMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-agent-session-mention-host';
import { createNativeAgentSessionMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-agent-session-mention-views';
import {
  createNativeBookingLinkMentionContext,
  createNativeBookingLinkMentionViews,
} from '@core/component/LexicalMarkdown/decorator-host/native-booking-views';
import { createNativeContactContext } from '@core/component/LexicalMarkdown/decorator-host/native-contact-host';
import { createNativeDatabaseQueryContext } from '@core/component/LexicalMarkdown/decorator-host/native-database-query-host';
import { createNativeDatabaseQueryViews } from '@core/component/LexicalMarkdown/decorator-host/native-database-query-views';
import { createNativeDateMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-date-mention-host';
import { createNativeDateMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-date-mention-views';
import { createNativeDiffInsertContext } from '@core/component/LexicalMarkdown/decorator-host/native-diff-insert-host';
import { createNativeDiffInsertViews } from '@core/component/LexicalMarkdown/decorator-host/native-diff-insert-views';
import { createNativeDiffElementView } from '@core/component/LexicalMarkdown/decorator-host/native-diff-view';
import { createNativeDocumentCardContext } from '@core/component/LexicalMarkdown/decorator-host/native-document-card-host';
import { createNativeDocumentCardViews } from '@core/component/LexicalMarkdown/decorator-host/native-document-card-views';
import { createNativeDocumentMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-document-mention-host';
import { createNativeDocumentMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-document-mention-views';
import { createNativeEquationContext } from '@core/component/LexicalMarkdown/decorator-host/native-equation-host';
import { createNativeEquationViews } from '@core/component/LexicalMarkdown/decorator-host/native-equation-views';
import { createNativeHorizontalRuleViews } from '@core/component/LexicalMarkdown/decorator-host/native-horizontal-rule';
import { createNativeImageContext } from '@core/component/LexicalMarkdown/decorator-host/native-image-host';
import { createNativeImageDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/native-image-views';
import { createNativeMagicDecoratorContext } from '@core/component/LexicalMarkdown/decorator-host/native-magic-host';
import { createNativePasteNodeContext } from '@core/component/LexicalMarkdown/decorator-host/native-paste-node-host';
import { createNativePasteNodeViews } from '@core/component/LexicalMarkdown/decorator-host/native-paste-node-views';
import {
  createNativePullRequestMentionContext,
  createNativePullRequestMentionViews,
} from '@core/component/LexicalMarkdown/decorator-host/native-pr-mention-views';
import { createNativeSelectionDecoratorContext } from '@core/component/LexicalMarkdown/decorator-host/native-selection-host';
import {
  createNativeSnapshotContext,
  createNativeSnapshotViews,
} from '@core/component/LexicalMarkdown/decorator-host/native-snapshot-views';
import { createNativeTagMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-tag-mention-host';
import { createNativeTagMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-tag-mention-views';
import { createNativeUserMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-user-mention-host';
import { createNativeUserMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-user-mention-views';
import {
  createNativeVideoContext,
  createNativeVideoDecoratorViews,
} from '@core/component/LexicalMarkdown/decorator-host/native-video-views';
import { installNativeMarkdownOverlays } from '@core/component/LexicalMarkdown/editing/installNativeMarkdownOverlays';
import { createNativeCreationComposerController } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-creation';
import { createNativeDatabaseController } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-database';
import { createNativeGifContext } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-gif';
import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import { registerNativeTitleHandoffKeys } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-title-handoff';
import {
  BlameTooltip,
  createBlameTooltipStore,
} from '@core/component/LexicalMarkdown/plugins/blame-tooltip';
import { registerNativeBlameTooltip } from '@core/component/LexicalMarkdown/plugins/blame-tooltip/native';
import { createNativeChecklistPlanHost } from '@core/component/LexicalMarkdown/plugins/checklist-controls/native-plan-host';
import {
  createNativeCodeAccessories,
  type NativeCodeAccessories,
} from '@core/component/LexicalMarkdown/plugins/code/native-accessory';
import { installNativeCodeChrome } from '@core/component/LexicalMarkdown/plugins/code/native-code-highlight-dom';
import {
  nativeDocumentMetadataError,
  registerNativeDocumentMetadata,
} from '@core/component/LexicalMarkdown/plugins/document-metadata/native';
import { createNativeEditorStats } from '@core/component/LexicalMarkdown/plugins/editor-stats/native';
import { FloatingSearchHighlight } from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import { createNativeDocumentFind } from '@core/component/LexicalMarkdown/plugins/find-and-replace/native';
import { NativeSearchHighlight } from '@core/component/LexicalMarkdown/plugins/find-and-replace/nativeSearchHighlight';
import {
  type PersistentLocation,
  parsePersistentLocation,
} from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import {
  nativeGoToLocation,
  nativeGoToNodeId,
} from '@core/component/LexicalMarkdown/plugins/location/native';
import { createNativeImageUploadController } from '@core/component/LexicalMarkdown/plugins/media/native-image-upload';
import { nativePinnedPropertyStore } from '@core/component/LexicalMarkdown/plugins/pinned-properties/native';
import type { PinnedPropertyStore } from '@core/component/LexicalMarkdown/plugins/pinned-properties/store';
import { createProgressStatsStore } from '@core/component/LexicalMarkdown/plugins/progress';
import { registerNativeTextPaste } from '@core/component/LexicalMarkdown/plugins/text-paste/native';
import { createWordcountStatsStore } from '@core/component/LexicalMarkdown/plugins/wordcount';
import { theme } from '@core/component/LexicalMarkdown/theme';
import { useUrlParams } from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_SVG_PREVIEW,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { loadDocumentSession } from '@core/document-session/load';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import {
  createBuiltinRegistry,
  type MacroDecorators,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { useDocTags } from '@property/tags';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  isAndroid,
  isFirefox,
  isIOS,
  isSafari,
} from '@solid-primitives/platform';
import {
  type Accessor,
  createEffect,
  createSignal,
  getOwner,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createRustEditorSession } from '../primitives/create-rust-editor-session';
import { createEditorAuthorization } from '../queries/editor-authorization';
import { createNativeBodyFormattingOverlay } from './format-host/native-overlay';
import { createNativeEditorDrop } from './native-editor-drop';
import { nativeCommandTarget } from './useMarkdownCommands';

export type RustMarkdownRuntime = Awaited<
  ReturnType<typeof createRustEditorSession>
> & {
  /** Built here so shared document chrome never imports the native store. */
  readonly pinnedProperties: PinnedPropertyStore;
};

/** Flagged body engine; document layout and status chrome belong to the host. */
export default function RustMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
  onReady?: () => void;
  onRuntime?: (runtime: RustMarkdownRuntime | undefined) => void;
  onEmptyChange?: (empty: boolean) => void;
  onError?: (error: Error) => void;
  /** The document chrome's container, where Source attaches its drop handlers. */
  container?: Accessor<HTMLDivElement | undefined>;
}) {
  const namespace = allocateEditorNamespace('block-md-main');
  const flow = useFlow();
  const userId = useUserId();
  const resolveAppLink = useMacroMentionLinkResolver();
  const authenticated = useIsAuthenticated();
  const { commentId } = useUrlParams(URL_PARAMS);
  const owner = getOwner() ?? undefined;
  const {
    documentId,
    kind,
    permissions,
    state,
    bodyFormatPopup,
    persistedName,
    fallbackName,
  } = useMarkdownDocument();
  const documentKind = kind();
  const documentTags = useDocTags(
    documentId(),
    documentKind === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const [runtime, setRuntime] = createSignal<RustMarkdownRuntime>();
  const [ready, setReady] = createSignal(false);
  const abort = new AbortController();
  const canEdit = () =>
    ready() && !state.editor.error() && permissions.canEdit();
  const userMentionContext = createNativeUserMentionContext(theme);
  const overlayLifecycle = createNativeListenerScope();
  const checklist = createNativeChecklistPlanHost((error) => {
    Telemetry.error(error, { surface: 'native-checklist-controls' });
  });
  overlayLifecycle.add(checklist.dispose);
  overlayLifecycle.add(() => userMentionContext.dispose());
  const contactContext = createNativeContactContext(theme);
  overlayLifecycle.add(() => contactContext.dispose());
  const bookingLinkMentionContext =
    createNativeBookingLinkMentionContext(theme);
  overlayLifecycle.add(() => bookingLinkMentionContext.dispose());
  const tagMentionContext = createNativeTagMentionContext(theme);
  overlayLifecycle.add(() => tagMentionContext.dispose());
  const dateMentionContext = createNativeDateMentionContext(theme);
  overlayLifecycle.add(() => dateMentionContext.dispose());
  const pasteNodeContext = createNativePasteNodeContext(theme);
  overlayLifecycle.add(() => pasteNodeContext.dispose());
  const pullRequestMentionContext =
    createNativePullRequestMentionContext(theme);
  overlayLifecycle.add(() => pullRequestMentionContext.dispose());
  const snapshotContext = createNativeSnapshotContext(theme);
  overlayLifecycle.add(() => snapshotContext.dispose());
  const equationContext = createNativeEquationContext(theme);
  overlayLifecycle.add(() => equationContext.dispose());
  const gifContext = createNativeGifContext();
  overlayLifecycle.add(() => gifContext.dispose());
  const [floatingMenusActive, setFloatingMenusActive] = createSignal(true);
  overlayLifecycle.add(() => setFloatingMenusActive(false));
  const imageUploads = createNativeImageUploadController({
    mentionSourceId: documentId,
  });
  const editorDrop = createNativeEditorDrop({
    view: () => runtime()?.view,
    canEdit: () => canEdit(),
    sourceId: documentId,
    droppableId: namespace,
    dropFiles: (files, folders, at) =>
      imageUploads.dropFiles(files, folders, at),
  });
  createEffect(
    on(
      () => props.container?.(),
      (container) => {
        if (container) editorDrop.connect(container);
      }
    )
  );
  overlayLifecycle.add(() => imageUploads.dispose());
  const canInteractWithMedia = () =>
    ready() &&
    permissions.canEdit() &&
    !state.generation.isGenerating() &&
    !state.generation.generatedAndWaiting() &&
    !state.editor.error();
  const formatting = createNativeBodyFormattingOverlay({
    composition: bodyFormatPopup,
    canEdit: canInteractWithMedia,
    alive: () => !abort.signal.aborted,
    snippetLink: { documentId },
    touch: {
      documentId,
      view: () => runtime()?.view,
      comments: {
        highlighted: () => state.comments.highlightedCommentThreads,
        activate: (thread) =>
          state.setCommentState('activeCommentThread', thread),
        caretCommentIds: (selection) =>
          runtime()?.overlays?.comments?.caretCommentIds(selection) ?? null,
      },
    },
    tasks: {
      view: () => runtime()?.view,
      currentUserId: userId,
      // Source MarkdownEditor: a task's checklist items become its subtasks.
      parentTaskId: documentKind === 'task' ? documentId() : undefined,
      documentId,
      documentName: () => persistedName() ?? fallbackName() ?? '',
    },
    aiEdit: {
      documentId,
      view: () => runtime()?.view,
      enabled: () => canEdit(),
      parentSpan: flow.span,
    },
    comment: {
      // Source: <Show when={ENABLE_MARKDOWN_COMMENTS && canComment()}>; the
      // draft capability exists only while the native provider is mounted.
      canComment: () =>
        ready() &&
        !abort.signal.aborted &&
        ENABLE_MARKDOWN_COMMENTS &&
        authenticated() === true &&
        permissions.canComment() &&
        state.editor.md.commentDraft !== undefined,
      insert: () => state.editor.md.commentDraft?.create() ?? false,
    },
  });
  overlayLifecycle.add(formatting.dispose);
  const documentMentionContext = createNativeDocumentMentionContext(theme, {
    isInteractable: canInteractWithMedia,
  });
  overlayLifecycle.add(() => documentMentionContext.dispose());
  const documentCardContext = createNativeDocumentCardContext(theme, {
    isInteractable: canInteractWithMedia,
  });
  overlayLifecycle.add(() => documentCardContext.dispose());
  const agentSessionMentionContext = createNativeAgentSessionMentionContext(
    theme,
    canInteractWithMedia
  );
  overlayLifecycle.add(() => agentSessionMentionContext.dispose());
  const databaseQueryContext = createNativeDatabaseQueryContext(
    theme,
    canInteractWithMedia
  );
  overlayLifecycle.add(() => databaseQueryContext.dispose());
  const imageContext = createNativeImageContext(
    theme,
    canInteractWithMedia,
    imageUploads.events
  );
  overlayLifecycle.add(() => imageContext.dispose());
  const videoContext = createNativeVideoContext(
    theme,
    canInteractWithMedia,
    imageUploads.events
  );
  overlayLifecycle.add(() => videoContext.dispose());
  const selectionContext = createNativeSelectionDecoratorContext(theme);
  overlayLifecycle.add(() => selectionContext.dispose());
  const magicContext = createNativeMagicDecoratorContext(
    theme,
    'markdown-sync'
  );
  overlayLifecycle.add(() => magicContext.dispose());
  const diffInsertContext = createNativeDiffInsertContext(theme);
  overlayLifecycle.add(() => diffInsertContext.dispose());
  const [codeAccessories, setCodeAccessories] =
    createSignal<NativeCodeAccessories>();
  const findAndReplace = state.editor.findAndReplace;
  const documentFind = createNativeDocumentFind({
    getListOffset: () => findAndReplace.listOffset,
    setListOffset: state.editor.setFindListOffset,
    refreshQuery: () =>
      findAndReplace.searchIsOpen && findAndReplace.searchInputText
        ? findAndReplace.searchInputText
        : undefined,
  });
  const [highlightLayer, setHighlightLayer] = createSignal<HTMLElement>();
  const [wordcountStats, setWordcountStats] = createWordcountStatsStore();
  const [progressStats, setProgressStats] = createProgressStatsStore();
  const editorStats = createNativeEditorStats({
    setWordcount: setWordcountStats,
    setProgress: setProgressStats,
    debounceTime: 200,
  });
  state.editor.setMd('wordcountStats', wordcountStats);
  state.editor.setMd('progressStats', progressStats);
  let root: HTMLDivElement | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let releaseCommit: (() => void) | undefined;
  let releaseEmpty: (() => void) | undefined;
  let releaseScrollTelemetry: (() => void) | undefined;
  let lastError: Error | undefined;
  let versionMismatch = false;
  let reportOpenStatus: ((status: number) => void) | undefined;
  let syncStatus = 0;
  const clearPublicRuntime = () => {
    try {
      props.onRuntime?.(undefined);
    } catch (error) {
      try {
        Telemetry.error(error, { surface: 'rust-editor.runtime.cleanup' });
      } catch {
        // Cleanup must not hide the editor's original open failure.
      }
    }
  };
  const showError = (value: unknown) => {
    const failure =
      value instanceof Error ? value : new Error('Editor session failed');
    const versionError = nativeDocumentMetadataError(failure);
    if (versionError && !abort.signal.aborted) {
      // Source retains its installed content under the warning, without ready/sync.
      // Keep the view and its selection/copy handlers alive until owner disposal.
      versionMismatch = true;
      state.editor.setError(versionError);
      setReady(false);
      return;
    }
    rejectReady?.(failure);
    if (!abort.signal.aborted && failure !== lastError) {
      lastError = failure;
      setReady(false);
      clearPublicRuntime();
      props.onError?.(failure);
      Telemetry.error(failure, { surface: 'rust-editor.session' });
    }
  };
  onCleanup(() => {
    abort.abort();
    try {
      // Unmount UI and retire host callbacks before the asynchronous close starts.
      overlayLifecycle.dispose();
    } finally {
      state.session.setStatus(undefined);
      if (state.editor.md.documentFind === documentFind.engine)
        state.editor.setMd('documentFind', undefined);
      if (state.editor.md.wordcountStats === wordcountStats)
        state.editor.setMd('wordcountStats', undefined);
      if (state.editor.md.progressStats === progressStats)
        state.editor.setMd('progressStats', undefined);
      rejectReady?.(new Error('Editor open cancelled'));
      releaseCommit?.();
      releaseEmpty?.();
      releaseScrollTelemetry?.();
      clearPublicRuntime();
      const current = runtime();
      if (current) fireAndForget(current.close(), 'rust-editor.close');
    }
  });
  createEffect(() => {
    runtime()?.view.setEditable(canEdit());
    codeAccessories()?.refreshEditable();
  });

  // Source MarkdownEditor's persistent-location and node-ID navigation.
  const [highlightNodeId, setHighlightNodeId] = createSignal<string>();
  const [activeLocation, setActiveLocation] =
    createSignal<PersistentLocation>();
  const [locationReady, setLocationReady] = createSignal(false);
  const urlParams = useUrlParams(URL_PARAMS);
  createEffect(
    on(urlParams.nodeId, (id) => setHighlightNodeId(id ?? undefined))
  );
  createEffect(
    on(urlParams.location, (serialized) => {
      const parsed = serialized && parsePersistentLocation(serialized);
      if (parsed) setActiveLocation(parsed);
    })
  );
  // Lags readiness like Source so the first scroll follows reconciliation.
  const markLocationReady = () => {
    setLocationReady(true);
    state.editor.setMd('locationReady', true);
  };
  onCleanup(() => state.editor.setMd('locationReady', undefined));
  // Revocation only follows a successful navigation, as in Source.
  let navigatedLocation = false;
  createEffect(() => {
    const view = runtime()?.view;
    const location = activeLocation();
    if (!view || !location || !locationReady()) return;
    navigatedLocation = nativeGoToLocation(view, location);
  });
  createEffect(() => {
    const view = runtime()?.view;
    const id = highlightNodeId();
    if (!view || !id || !locationReady()) return;
    setHighlightNodeId(undefined);
    if (!nativeGoToNodeId(view, id))
      toast.failure('Document reference not found');
  });
  const [blameTooltipStore, setBlameTooltipStore] = createBlameTooltipStore();
  const bindLocationAndBlame = (mounted: RustMarkdownRuntime) => {
    overlayLifecycle.add(
      mounted.view.onCommit((commit) => {
        if (!navigatedLocation || !locationReady()) return;
        if (commit.mutations.size > 0 || commit.selectionChanged) {
          navigatedLocation = false;
          setActiveLocation(undefined);
        }
      })
    );
    overlayLifecycle.add(
      registerNativeBlameTooltip(mounted.view, (blame) =>
        setBlameTooltipStore(blame)
      )
    );
  };
  onMount(() => {
    const openStarted = performance.now();
    fireAndForget(
      flow
        .task('session.init', async () => {
          flow.span.setAttr('document.id', documentId());
          // Source bundles Prism with the editor; load it alongside the WASM.
          const [module, codeTokens] = await Promise.all([
            flow.task('wasm.init', (span) => loadDocumentSession(span)),
            flow.task(
              'code-tokens.load',
              () =>
                import(
                  '@core/component/LexicalMarkdown/plugins/code/native-code-tokens'
                )
            ),
          ]);
          const element = root;
          if (abort.signal.aborted || !element) return;
          const authorization = createEditorAuthorization(
            documentId(),
            props.context
          );
          await flow.task('state.load', async () => {
            const session = await createRustEditorSession({
              module,
              root: element,
              codeTokens: {
                provider: codeTokens.createNativeCodeTokenProvider(),
                profile: codeTokens.NATIVE_CODE_TOKEN_PROFILE,
              },
              latestPublished: [
                formatting.observer,
                checklist.observer,
                documentFind.observer,
                editorStats,
              ],
              registry: registerMacroDecoratorViews(
                registerMacroElementViews(createBuiltinRegistry(), {
                  svgPreview: ENABLE_SVG_PREVIEW,
                }).replace('diff', createNativeDiffElementView(userId)),
                {
                  ...createNativeUserMentionViews(userMentionContext),
                  ...createNativeFastContactDecoratorViews(contactContext),
                  ...createNativeBookingLinkMentionViews(
                    bookingLinkMentionContext
                  ),
                  ...createNativeTagMentionViews(tagMentionContext),
                  ...createNativeDateMentionViews(dateMentionContext),
                  ...createNativePasteNodeViews(pasteNodeContext),
                  ...createNativeDatabaseQueryViews(databaseQueryContext),
                  ...createNativeAgentSessionMentionViews(
                    agentSessionMentionContext
                  ),
                  ...createNativePullRequestMentionViews(
                    pullRequestMentionContext
                  ),
                  ...createNativeSnapshotViews(snapshotContext),
                  ...createNativeEquationViews(equationContext),
                  ...createNativeDocumentMentionViews(documentMentionContext),
                  ...createNativeDocumentCardViews(documentCardContext),
                  ...createNativeImageDecoratorViews(imageContext),
                  ...createNativeVideoDecoratorViews(videoContext),
                  ...createNativeFastStaticDecoratorViews(selectionContext),
                  ...createNativeFastSelectionDecoratorViews(selectionContext),
                  ...createNativeFastCachedDecoratorViews(magicContext),
                  ...createNativeDiffInsertViews(diffInsertContext),
                  ...createNativeHorizontalRuleViews(selectionContext.bindView),
                  ...createNativeFastHTMLDecoratorViews({
                    theme,
                    host: {},
                    bindView(view) {
                      if (view.root !== element)
                        throw new Error(
                          'HTML decorator belongs to another editor'
                        );
                    },
                  }),
                } satisfies MacroDecorators
              ),
              installOverlays(view) {
                try {
                  if (abort.signal.aborted)
                    throw new Error('Editor open cancelled');
                  overlayLifecycle.add(
                    registerNativeDocumentMetadata(view, state.editor.setError)
                  );
                  const creation = createNativeCreationComposerController(view);
                  overlayLifecycle.add(creation.dispose);
                  const database = createNativeDatabaseController(view);
                  overlayLifecycle.add(database.dispose);
                  const installed = installNativeMarkdownOverlays(view, {
                    canEdit,
                    tasks: {
                      currentUserId: userId,
                      // Source MarkdownEditor: a task's checklist items become its subtasks.
                      parentTaskId:
                        kind() === 'task' ? documentId() : undefined,
                    },
                    formatting: formatting.Overlay,
                    checklist: () => (
                      <NativeChecklistOverlay view={view} host={checklist} />
                    ),
                    emoji: true,
                    mentions: {
                      sourceDocumentId: documentId(),
                      disableMentionTracking: false,
                    },
                    snippets: { sourceDocumentId: documentId() },
                    comments: true,
                    actions: {
                      actionContext: {
                        sourceDocumentId: documentId(),
                        sourceBlockName: kind() === 'document' ? 'md' : kind(),
                        disableMentionTracking: false,
                      },
                      requests: {
                        openFileDialog: (kind) =>
                          imageUploads.openFileDialog(kind),
                        requestEquation: () => equationContext.requestCreate(),
                        requestLink: () => formatting.requestLink(),
                        requestGif: () => gifContext.requestOpen(),
                        requestCreation: creation.requestCreation,
                        requestDatabase: database.requestDatabase,
                      },
                    },
                    tags: {
                      applyTargetLabel:
                        documentKind === 'task' ? 'Task' : 'Document',
                      isApplied: (tag) => documentTags.isApplied(tag.optionId),
                      onApplyTag(tag) {
                        if (!permissions.canEdit()) return;
                        fireAndForget(
                          documentTags.applyTag(tag.scope, tag.optionId),
                          'rust-editor.tags'
                        );
                      },
                    },
                  });
                  if (abort.signal.aborted) {
                    const late = createNativeListenerScope();
                    late.add(() => installed.dispose());
                    return late.fail(new Error('Editor open cancelled'));
                  }
                  overlayLifecycle.add(() => installed.dispose());
                  imageUploads.bindView(view);
                  return { ...installed, dispose: overlayLifecycle.dispose };
                } catch (error) {
                  return overlayLifecycle.fail(error);
                }
              },
              view: {
                namespace,
                owner,
                parentSpan: flow.span,
                editable: false,
                preset: 'rich',
                theme,
                onError: showError,
              },
              documentId: documentId(),
              loadCachedSnapshot: props.loadCachedSnapshot,
              user: authorization.user,
              access: authorization.access,
              authorization: authorization.auth,
              viewEngine:
                isIOS || isSafari || isPlatform('ios') ? 2 : isFirefox ? 3 : 1,
              viewOs:
                isIOS || isPlatform('ios')
                  ? 2
                  : isAndroid || isPlatform('android')
                    ? 3
                    : IS_MAC
                      ? 1
                      : 0,
              span: flow.span,
              onStatus(status) {
                if (abort.signal.aborted) return;
                syncStatus = status.code;
                reportOpenStatus?.(status.code);
                state.session.setStatus(
                  status.code === 1
                    ? SyncSourceStatus.Connected
                    : status.code === 0
                      ? SyncSourceStatus.Connecting
                      : SyncSourceStatus.Disconnected
                );
              },
            });
            const mounted: RustMarkdownRuntime = {
              ...session,
              pinnedProperties: nativePinnedPropertyStore(session.view),
            };
            if (abort.signal.aborted) {
              await mounted.close();
              return;
            }
            setRuntime(mounted);
            bindLocationAndBlame(mounted);
            overlayLifecycle.add(editorDrop.bindView(mounted.view));
            // Command menu (Cmd+K) formats and slash actions on the native body.
            state.editor.setMd(
              'nativeCommands',
              nativeCommandTarget({
                formatting: formatting.host,
                actions: () => mounted.overlays?.actions?.(),
                focus: () => mounted.view.focus(),
              })
            );
            overlayLifecycle.add(() =>
              state.editor.setMd('nativeCommands', undefined)
            );
            overlayLifecycle.add(
              registerNativeTextPaste(mounted.view, resolveAppLink)
            );
            overlayLifecycle.add(
              registerNativeTitleHandoffKeys(mounted.view, {
                titleEditor: () => state.editor.md.titleEditor,
                menuOpen: () => mounted.overlays?.menuOpen?.() ?? false,
              })
            );
            const accessories = createNativeCodeAccessories(mounted.view, {
              ready,
            });
            overlayLifecycle.add(() => {
              setCodeAccessories(undefined);
              accessories.dispose();
            });
            setCodeAccessories(accessories);
            overlayLifecycle.add(
              installNativeCodeChrome(mounted.view, {
                codeHighlighting: mounted.codeHighlighting,
              })
            );
            state.editor.setMd('documentFind', documentFind.engine);
            releaseScrollTelemetry = startEditorScrollTelemetry(
              mounted.view,
              documentId()
            );
            const reportEmpty = () => {
              const empty = mounted.view.isEmpty();
              if (empty === null) return;
              props.onEmptyChange?.(empty);
            };
            releaseEmpty = mounted.view.onCommit(reportEmpty);
            reportEmpty();
            if (abort.signal.aborted) return;
            await flow.task('editor.initial-projection', async (span) => {
              const waitStarted = performance.now();
              let phase = 'cancelled';
              let terminalStatus: number | undefined;
              span.setAttr('document.id', documentId());
              const observeStatus = (status: number) => {
                span.setAttr('editor.open.sync_status', status);
                span.setAttr(
                  'editor.open.wait_ms',
                  performance.now() - waitStarted
                );
                span.setAttr(
                  'editor.open.phase',
                  status === 2 ? 'retrying' : 'waiting-for-sync'
                );
                if (status === 3 || status === 4) {
                  terminalStatus = status;
                  rejectReady?.(
                    new Error(
                      status === 3
                        ? 'Editor connection retries exhausted'
                        : 'Editor connection closed before initialization'
                    )
                  );
                }
              };
              reportOpenStatus = observeStatus;
              try {
                if (lastError) throw lastError;
                await new Promise<void>((resolve, reject) => {
                  rejectReady = reject;
                  if (mounted.view.node(0)) {
                    resolve();
                    return;
                  }
                  // Native owns the same reconnect budget as the Source socket.
                  // A host timer must not close it when its first retry begins.
                  observeStatus(syncStatus);
                  releaseCommit = mounted.view.onCommit((commit) => {
                    if (commit.fullReconcile) resolve();
                  });
                });
                if (lastError) throw lastError;
                phase = versionMismatch ? 'version-mismatch' : 'initialized';
              } catch (error) {
                phase = abort.signal.aborted
                  ? 'cancelled'
                  : terminalStatus === 3
                    ? 'retries-exhausted'
                    : terminalStatus === 4
                      ? 'connection-closed'
                      : lastError
                        ? 'attach-error'
                        : 'failed';
                throw error;
              } finally {
                reportOpenStatus = undefined;
                releaseCommit?.();
                releaseCommit = undefined;
                rejectReady = undefined;
                span.setAttr('editor.open.phase', phase);
                span.setAttr('editor.open.sync_status', syncStatus);
                span.setAttr(
                  'editor.open.wait_ms',
                  performance.now() - waitStarted
                );
                span.setAttr(
                  'editor.open.elapsed_ms',
                  performance.now() - openStarted
                );
              }
            });
            if (versionMismatch) return;
            if (!abort.signal.aborted) {
              if (lastError) throw lastError;
              equationContext.bindView(mounted.view);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              gifContext.bindView(mounted.view);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              setReady(true);
              accessories.refreshEditable();
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              checklist.ready(mounted.view);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              props.onRuntime?.(mounted);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              props.onReady?.();
              setTimeout(() => {
                if (!abort.signal.aborted) markLocationReady();
              });
            }
            if (props.autoFocus && !isTouchDevice() && !abort.signal.aborted)
              mounted.view.focus();
          });
        })
        .catch((error) => {
          try {
            overlayLifecycle.fail(error);
          } catch (cause) {
            showError(cause);
          } finally {
            const current = runtime();
            if (current)
              fireAndForget(current.close(), 'rust-editor.open.close');
          }
        }),
      'rust-editor.open'
    );
  });
  return (
    <>
      <NativeChecklistFacts host={checklist} />
      <editorDrop.Indicator />
      <div
        ref={root}
        role="textbox"
        aria-multiline="true"
        aria-readonly={!canEdit()}
        aria-label="Document content"
        data-input-surface="editor"
        class="ph-no-capture w-full max-w-full min-h-52 md"
        classList={{ 'select-auto': !permissions.canEdit() }}
      />
      <Show when={locationReady() && runtime()}>
        {(mounted) => (
          <NativeLocationHighlight
            view={mounted().view}
            location={activeLocation()}
            class="bg-accent/50"
          />
        )}
      </Show>
      <Suspense>
        <BlameTooltip state={blameTooltipStore} documentId={documentId()} />
      </Suspense>
      <Show when={runtime()?.overlays?.Overlays}>
        {(Overlays) => <Dynamic component={Overlays()} />}
      </Show>
      <Show
        when={
          ENABLE_MARKDOWN_COMMENTS &&
          authenticated() === true &&
          runtime()?.overlays?.comments
        }
      >
        {(comments) => (
          <Suspense>
            <NativeMessageCommentsProvider
              activeComment={() => commentId() ?? undefined}
              comments={comments()}
              ready={ready}
            />
          </Suspense>
        )}
      </Show>
      <Show when={codeAccessories()}>
        {(accessories) => (
          <Show when={root?.parentElement}>
            {(parent) => (
              <NodeAccessoryLayer
                parent={parent()}
                store={accessories().store}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={documentFind.view()?.root.parentElement}>
        {(parent) => (
          <HighlightLayerMount parent={parent()} ref={setHighlightLayer} />
        )}
      </Show>
      <Show when={findAndReplace.searchIsOpen && documentFind.view()}>
        {(view) => (
          <Show when={highlightLayer()}>
            {(anchor) => (
              <>
                <NativeSearchHighlight
                  view={view()}
                  anchorElem={anchor()}
                  listOffset={findAndReplace.listOffset}
                  contentRevision={documentFind.contentRevision()}
                  onStylesChange={(styles) =>
                    state.editor.setFindAndReplace('styles', styles)
                  }
                  onMatchesChange={(matches) =>
                    state.editor.setFindAndReplace('matches', matches)
                  }
                />
                <FloatingSearchHighlight
                  anchorElem={anchor()}
                  styles={findAndReplace.styles}
                  currentMatch={findAndReplace.currentMatch}
                />
              </>
            )}
          </Show>
        )}
      </Show>
      <Show when={floatingMenusActive() && runtime()}>
        <DecoratorHostContext.Provider value={equationContext.host}>
          <FloatingMenuGroup>
            <FloatingEquationMenu canEdit={canEdit} />
            <HostedFloatingGifMenu
              canEdit={canEdit}
              host={gifContext.host}
              portalScope="global"
            />
          </FloatingMenuGroup>
        </DecoratorHostContext.Provider>
      </Show>
    </>
  );
}
