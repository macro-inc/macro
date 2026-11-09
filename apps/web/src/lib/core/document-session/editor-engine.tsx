import { Telemetry } from '@macro-inc/observability';
import {
  createContext,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createEditorEngineState } from './editor-engine-state';
import { RUST_EDITOR_ENGINE } from './engine-selection';
import { type DocumentSessionModule, loadDocumentSession } from './load';

type EditorEngine = ReturnType<
  typeof createEditorEngineState<DocumentSessionModule>
>;
const EditorEngineContext = createContext<EditorEngine>();

/** Preload in parallel with the shell; only editor boundaries observe readiness. */
export function EditorEngineProvider(props: ParentProps) {
  const engine = createEditorEngineState(
    () => RUST_EDITOR_ENGINE,
    () =>
      Telemetry.span('editor.engine.initialize', { sampling: 'perf' }, (span) =>
        loadDocumentSession(span)
      )
  );
  return (
    <EditorEngineContext.Provider value={engine}>
      {props.children}
    </EditorEngineContext.Provider>
  );
}

export function useEditorEngine(): EditorEngine {
  const engine = useContext(EditorEngineContext);
  if (!engine) throw new Error('EditorEngineProvider is required');
  return engine;
}

/** Place inside the shell, above any component that constructs editor handles. */
export function EditorEngineBoundary(
  props: ParentProps<{ fallback?: JSX.Element }>
) {
  const engine = useEditorEngine();
  return (
    <Show when={engine.ready()} fallback={props.fallback}>
      {props.children}
    </Show>
  );
}
