import { fireAndForget } from '@core/util/fireAndForget';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import { registerMacroElementViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { EditorState } from 'lexical';
import {
  type Accessor,
  createSignal,
  ErrorBoundary,
  getOwner,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '../../component/core/StaticMarkdown';
import { DecoratorHostContext } from '../../context/DecoratorHostContext';
import { theme } from '../../theme';
import { createNativeSelectionDecoratorContext } from '../native-selection-host';
import type { DecoratorSelectionHost } from '../selection-host';

declare global {
  interface Window {
    staticBoundaryCapture?: () => { model: string; dom: string };
  }
}

/** Real empty native view/context surrounding the production Source preview renderer. */
export function StaticHostBoundary(props: { native: boolean }) {
  let root: HTMLDivElement | undefined;
  let previewRoot: HTMLDivElement | undefined;
  let state: Accessor<EditorState | null> | undefined;
  const owner = getOwner();
  const [host, setHost] = createSignal<DecoratorSelectionHost>();
  const [failure, setFailure] = createSignal<string>();
  let runtime: ReturnType<typeof mountLocalSessionView> | undefined;
  let context:
    | ReturnType<typeof createNativeSelectionDecoratorContext>
    | undefined;
  let disposed = false;
  onMount(() => {
    window.staticBoundaryCapture = () => {
      if (!previewRoot || !state?.())
        throw new Error('Missing actual Source preview');
      return {
        model: JSON.stringify(state()?.toJSON()),
        dom: previewRoot.innerHTML,
      };
    };
    async function start() {
      try {
        const module = await import(
          '@core/document-session/wasm/document_session_wasm.js'
        );
        await module.default();
        if (disposed) return;
        if (!root) throw new Error('Missing actual native boundary root');
        runtime = mountLocalSessionView(
          root,
          registerMacroElementViews(createBuiltinRegistry()),
          {
            namespace: 'document-preview-boundary',
            theme,
            editable: true,
            preset: 'rich',
            owner: owner ?? undefined,
            onError(error) {
              throw error;
            },
          },
          {
            viewEngine: 1,
            viewOs: 0,
            nativeCommands: module,
            create: (config, now, wall) =>
              module.EditorSession.createMacroWithNamespace(
                ABI_MAJOR,
                config,
                now,
                wall,
                'document-preview-boundary'
              ),
          }
        );
        context = createNativeSelectionDecoratorContext(theme);
        context.bindView(runtime.view);
        setHost(context.host);
      } catch (error) {
        setFailure(String(error));
      }
    }
    fireAndForget(start(), 'document-preview-boundary');
  });
  onCleanup(() => {
    disposed = true;
    delete window.staticBoundaryCapture;
    context?.dispose();
    if (runtime)
      fireAndForget(runtime.close(), 'document-preview-boundary.close');
  });
  const preview = () => (
    <StaticMarkdownContext lazy={false}>
      <StaticMarkdown
        setStateRef={(actual) => {
          state = actual;
        }}
        markdown={
          '<m-user-mention>{"userId":"fixture-user","email":"user@example.com","displayName":"Preview User"}</m-user-mention>'
        }
      />
    </StaticMarkdownContext>
  );
  return (
    <>
      <div ref={root} />
      <Show when={failure()}>
        {(error) => <output data-boundary-error>{error()}</output>}
      </Show>
      <Show when={host()} keyed>
        {(actual) => (
          <ErrorBoundary
            fallback={(error) => (
              <output data-boundary-error>{String(error)}</output>
            )}
          >
            <div data-boundary-preview ref={previewRoot}>
              <Show when={props.native} fallback={preview()}>
                <DecoratorHostContext.Provider value={actual}>
                  {preview()}
                </DecoratorHostContext.Provider>
              </Show>
            </div>
          </ErrorBoundary>
        )}
      </Show>
    </>
  );
}
