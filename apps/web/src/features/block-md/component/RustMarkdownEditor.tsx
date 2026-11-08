import { useFlow } from '@app/observability/flow';
import { theme } from '@core/component/LexicalMarkdown/theme';
import { loadDocumentSession } from '@core/document-session/load';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import {
  isAndroid,
  isAppleDevice,
  isFirefox,
  isIOS,
  isSafari,
} from '@solid-primitives/platform';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createRustEditorSession } from '../primitives/create-rust-editor-session';
import { createEditorAuthorization } from '../queries/editor-authorization';
import { EditorSystemMessage } from './EditorSystemMessage';
import { TitleEditor } from './TitleEditor';

/** Flagged document surface; no legacy body collaboration owner is created. */
export default function RustMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  onReady?: () => void;
}) {
  const flow = useFlow();
  const { documentId, permissions, state } = useMarkdownDocument();
  const [error, setError] = createSignal<Error>();
  const [runtime, setRuntime] =
    createSignal<Awaited<ReturnType<typeof createRustEditorSession>>>();
  const abort = new AbortController();
  let root: HTMLDivElement | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let releaseCommit: (() => void) | undefined;
  onCleanup(() => {
    abort.abort();
    state.session.setStatus(undefined);
    rejectReady?.(new Error('Editor open cancelled'));
    releaseCommit?.();
    const current = runtime();
    if (current) fireAndForget(current.close(), 'rust-editor.close');
  });
  createEffect(() => runtime()?.view.setEditable(permissions.canEdit()));
  onMount(() => {
    fireAndForget(
      flow.task('session.init', async () => {
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
        const showError = (value: unknown) => {
          const failure =
            value instanceof Error ? value : new Error('Editor session failed');
          rejectReady?.(failure);
          if (!abort.signal.aborted) {
            setError(failure);
            Telemetry.error(failure, { surface: 'rust-editor.session' });
          }
        };
        await flow.task('state.load', async () => {
          const mounted = await createRustEditorSession({
            module,
            root: element,
            registry: createBuiltinRegistry(),
            view: {
              namespace: 'block-md-main',
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
      }).catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure
              : new Error('Editor could not open')
          );
      }),
      'rust-editor.open'
    );
  });
  return (
    <div class="w-full grow overflow-auto relative" data-block-content>
      <div class="flex relative text-ink min-h-full min-w-0 isolate px-6">
        <div class="grow basis-0 max-w-3xl pt-12 touch:pt-6 min-w-0 mx-auto">
          <TitleEditor autoFocusOnMount={props.autoFocus} />
          <div class="spacer h-3" />
          <Show when={error()}>
            <EditorSystemMessage variant="warning">
              The document editor could not open. Reopen the document to retry.
            </EditorSystemMessage>
          </Show>
          <div
            ref={root}
            role="textbox"
            aria-multiline="true"
            aria-readonly={!permissions.canEdit()}
            aria-label="Document content"
            data-input-surface="editor"
            class="md ph-no-capture w-full max-w-full min-h-52 relative mt-1.5 text-base"
          />
        </div>
      </div>
    </div>
  );
}
