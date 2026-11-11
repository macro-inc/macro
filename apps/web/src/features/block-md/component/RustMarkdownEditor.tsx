import { startEditorScrollTelemetry } from '@app/observability/editor';
import { useFlow } from '@app/observability/flow';
import { NativeMessageCommentsProvider } from '@block-md/comments/NativeMessageCommentsProvider';
import { URL_PARAMS } from '@block-md/constants';
import { FloatingEquationMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingEquationMenu';
import { DecoratorHostContext } from '@core/component/LexicalMarkdown/context/DecoratorHostContext';
import { allocateEditorNamespace } from '@core/component/LexicalMarkdown/context/editor-namespace';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { createNativeFastCachedDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-cached-views';
import { createNativeFastContactDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-contact-views';
import { createNativeFastHTMLDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-html-views';
import { createNativeFastSelectionDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-selection-views';
import { createNativeFastStaticDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/fast-static-views';
import { createNativeContactContext } from '@core/component/LexicalMarkdown/decorator-host/native-contact-host';
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
import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import { createNativeImageUploadController } from '@core/component/LexicalMarkdown/plugins/media/native-image-upload';
import { theme } from '@core/component/LexicalMarkdown/theme';
import { useUrlParams } from '@core/component/ParamsProvider';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { loadDocumentSession } from '@core/document-session/load';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import {
  createBuiltinRegistry,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { useDocTags } from '@property/tags';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  isAndroid,
  isAppleDevice,
  isFirefox,
  isIOS,
  isSafari,
} from '@solid-primitives/platform';
import {
  createEffect,
  createSignal,
  getOwner,
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

export type RustMarkdownRuntime = Awaited<
  ReturnType<typeof createRustEditorSession>
>;

/** Flagged body engine; document layout and status chrome belong to the host. */
export default function RustMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
  onReady?: () => void;
  onRuntime?: (runtime: RustMarkdownRuntime | undefined) => void;
  onEmptyChange?: (empty: boolean) => void;
  onError?: (error: Error) => void;
}) {
  const namespace = allocateEditorNamespace('block-md-main');
  const flow = useFlow();
  const userId = useUserId();
  const authenticated = useIsAuthenticated();
  const { commentId } = useUrlParams(URL_PARAMS);
  const owner = getOwner() ?? undefined;
  const { documentId, kind, permissions, state } = useMarkdownDocument();
  const documentKind = kind();
  const documentTags = useDocTags(
    documentId(),
    documentKind === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const [runtime, setRuntime] = createSignal<RustMarkdownRuntime>();
  const [ready, setReady] = createSignal(false);
  const abort = new AbortController();
  const canEdit = () => ready() && permissions.canEdit();
  const userMentionContext = createNativeUserMentionContext(theme);
  const overlayLifecycle = createNativeListenerScope();
  overlayLifecycle.add(() => userMentionContext.dispose());
  const contactContext = createNativeContactContext(theme);
  overlayLifecycle.add(() => contactContext.dispose());
  const tagMentionContext = createNativeTagMentionContext(theme);
  overlayLifecycle.add(() => tagMentionContext.dispose());
  const pullRequestMentionContext =
    createNativePullRequestMentionContext(theme);
  overlayLifecycle.add(() => pullRequestMentionContext.dispose());
  const snapshotContext = createNativeSnapshotContext(theme);
  overlayLifecycle.add(() => snapshotContext.dispose());
  const equationContext = createNativeEquationContext(theme);
  overlayLifecycle.add(() => equationContext.dispose());
  const [equationMenuActive, setEquationMenuActive] = createSignal(true);
  overlayLifecycle.add(() => setEquationMenuActive(false));
  const imageUploads = createNativeImageUploadController();
  overlayLifecycle.add(() => imageUploads.dispose());
  const canInteractWithMedia = () =>
    ready() &&
    permissions.canEdit() &&
    !state.generation.isGenerating() &&
    !state.generation.generatedAndWaiting() &&
    !state.editor.error();
  const formatting = createNativeBodyFormattingOverlay({
    canEdit: canInteractWithMedia,
    alive: () => !abort.signal.aborted,
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
  let root: HTMLDivElement | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let releaseCommit: (() => void) | undefined;
  let releaseEmpty: (() => void) | undefined;
  let releaseScrollTelemetry: (() => void) | undefined;
  let lastError: Error | undefined;
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
      rejectReady?.(new Error('Editor open cancelled'));
      releaseCommit?.();
      releaseEmpty?.();
      releaseScrollTelemetry?.();
      clearPublicRuntime();
      const current = runtime();
      if (current) fireAndForget(current.close(), 'rust-editor.close');
    }
  });
  createEffect(() => runtime()?.view.setEditable(canEdit()));
  onMount(() => {
    const openStarted = performance.now();
    fireAndForget(
      flow
        .task('session.init', async () => {
          flow.span.setAttr('document.id', documentId());
          const module = await flow.task('wasm.init', (span) =>
            loadDocumentSession(span)
          );
          const element = root;
          if (abort.signal.aborted || !element) return;
          const authorization = createEditorAuthorization(
            documentId(),
            props.context
          );
          await flow.task('state.load', async () => {
            const mounted = await createRustEditorSession({
              module,
              root: element,
              latestPublished: [formatting.observer],
              registry: registerMacroDecoratorViews(
                registerMacroElementViews(createBuiltinRegistry()).replace(
                  'diff',
                  createNativeDiffElementView(userId)
                ),
                {
                  ...createNativeUserMentionViews(userMentionContext),
                  ...createNativeFastContactDecoratorViews(contactContext),
                  ...createNativeTagMentionViews(tagMentionContext),
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
                }
              ),
              installOverlays(view) {
                try {
                  if (abort.signal.aborted)
                    throw new Error('Editor open cancelled');
                  const installed = installNativeMarkdownOverlays(view, {
                    canEdit,
                    formatting: formatting.Overlay,
                    mentions: {
                      sourceDocumentId: documentId(),
                      disableMentionTracking: false,
                    },
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
                    : isAppleDevice
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
            if (abort.signal.aborted) {
              await mounted.close();
              return;
            }
            setRuntime(mounted);
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
                phase = 'initialized';
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
            if (!abort.signal.aborted) {
              if (lastError) throw lastError;
              equationContext.bindView(mounted.view);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              setReady(true);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              props.onRuntime?.(mounted);
              if (abort.signal.aborted) return;
              if (lastError) throw lastError;
              props.onReady?.();
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
      <Show when={equationMenuActive() && runtime()}>
        <DecoratorHostContext.Provider value={equationContext.host}>
          <FloatingMenuGroup>
            <FloatingEquationMenu canEdit={canEdit} />
          </FloatingMenuGroup>
        </DecoratorHostContext.Provider>
      </Show>
    </>
  );
}
