import { startEditorScrollTelemetry } from '@app/observability/editor';
import { useFlow } from '@app/observability/flow';
import { allocateEditorNamespace } from '@core/component/LexicalMarkdown/context/editor-namespace';
import { createNativeUserMentionContext } from '@core/component/LexicalMarkdown/decorator-host/native-user-mention-host';
import { createNativeUserMentionViews } from '@core/component/LexicalMarkdown/decorator-host/native-user-mention-views';
import { installNativeMarkdownOverlays } from '@core/component/LexicalMarkdown/editing/installNativeMarkdownOverlays';
import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import { theme } from '@core/component/LexicalMarkdown/theme';
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
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
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
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createRustEditorSession } from '../primitives/create-rust-editor-session';
import { createEditorAuthorization } from '../queries/editor-authorization';

export type RustMarkdownRuntime = Awaited<
  ReturnType<typeof createRustEditorSession>
>;

/** Flagged body engine; document layout and status chrome belong to the host. */
export default function RustMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  onReady?: () => void;
  onRuntime?: (runtime: RustMarkdownRuntime | undefined) => void;
  onEmptyChange?: (empty: boolean) => void;
  onError?: (error: Error) => void;
}) {
  const namespace = allocateEditorNamespace('block-md-main');
  const flow = useFlow();
  const owner = getOwner() ?? undefined;
  const { documentId, permissions, state } = useMarkdownDocument();
  const [runtime, setRuntime] = createSignal<RustMarkdownRuntime>();
  const abort = new AbortController();
  const userMentionContext = createNativeUserMentionContext(theme);
  const overlayLifecycle = createNativeListenerScope();
  overlayLifecycle.add(() => userMentionContext.dispose());
  let root: HTMLDivElement | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let releaseCommit: (() => void) | undefined;
  let releaseEmpty: (() => void) | undefined;
  let releaseScrollTelemetry: (() => void) | undefined;
  let lastError: Error | undefined;
  const showError = (value: unknown) => {
    const failure =
      value instanceof Error ? value : new Error('Editor session failed');
    rejectReady?.(failure);
    if (!abort.signal.aborted && failure !== lastError) {
      lastError = failure;
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
      props.onRuntime?.(undefined);
      const current = runtime();
      if (current) fireAndForget(current.close(), 'rust-editor.close');
    }
  });
  createEffect(() => runtime()?.view.setEditable(permissions.canEdit()));
  onMount(() => {
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
              registry: registerMacroDecoratorViews(
                registerMacroElementViews(createBuiltinRegistry()),
                createNativeUserMentionViews(userMentionContext)
              ),
              installOverlays(view) {
                try {
                  if (abort.signal.aborted)
                    throw new Error('Editor open cancelled');
                  const installed = installNativeMarkdownOverlays(view, {
                    canEdit: permissions.canEdit,
                    mentions: {
                      sourceDocumentId: documentId(),
                      disableMentionTracking: false,
                    },
                  });
                  if (abort.signal.aborted) {
                    const late = createNativeListenerScope();
                    late.add(() => installed.dispose());
                    return late.fail(new Error('Editor open cancelled'));
                  }
                  overlayLifecycle.add(() => installed.dispose());
                  return { ...installed, dispose: overlayLifecycle.dispose };
                } catch (error) {
                  return overlayLifecycle.fail(error);
                }
              },
              view: {
                namespace,
                owner,
                parentSpan: flow.span,
                editable: permissions.canEdit(),
                preset: 'rich',
                theme,
                onError: showError,
              },
              documentId: documentId(),
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
            props.onRuntime?.(mounted);
            if (abort.signal.aborted) return;
            await new Promise<void>((resolve, reject) => {
              rejectReady = reject;
              if (mounted.view.node(0)) {
                resolve();
                return;
              }
              releaseCommit = mounted.view.onCommit((commit) => {
                if (commit.fullReconcile) {
                  releaseCommit?.();
                  resolve();
                }
              });
            });
            if (!abort.signal.aborted) props.onReady?.();
            if (props.autoFocus && !isTouchDevice() && !abort.signal.aborted)
              mounted.view.focus();
          });
        })
        .catch((error) => {
          try {
            overlayLifecycle.fail(error);
          } catch (cause) {
            showError(cause);
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
        aria-readonly={!permissions.canEdit()}
        aria-label="Document content"
        data-input-surface="editor"
        class="ph-no-capture w-full max-w-full min-h-52 md"
        classList={{ 'select-auto': !permissions.canEdit() }}
      />
      <Show when={runtime()?.overlays?.Overlays}>
        {(Overlays) => <Dynamic component={Overlays()} />}
      </Show>
    </>
  );
}
