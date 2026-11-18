import { perfMark } from '@app/observability/perf-marks';
import { Telemetry } from '@macro-inc/observability';
import {
  createContext,
  type JSX,
  Match,
  type ParentProps,
  Switch,
  useContext,
} from 'solid-js';
import { fireAndForget } from '../util/fireAndForget';
import { createEditorEngineState } from './editor-engine-state';
import { RUST_EDITOR_ENGINE } from './engine-selection';
import { type DocumentSessionModule, loadDocumentSession } from './load';
import { prepareEditorEngine } from './prepare-editor-engine';

type EditorEngine = ReturnType<
  typeof createEditorEngineState<DocumentSessionModule>
>;
const EditorEngineContext = createContext<EditorEngine>();

/** Preload in parallel with the shell; only editor boundaries observe readiness. */
export function EditorEngineProvider(props: ParentProps) {
  perfMark('editor.engine.selected', {
    engine: RUST_EDITOR_ENGINE ? 'rust' : 'upstream',
  });
  if (!RUST_EDITOR_ENGINE)
    perfMark('editor.engine.ready', { engine: 'upstream' });
  const engine = createEditorEngineState(
    () => RUST_EDITOR_ENGINE,
    () => {
      perfMark('editor.engine.preload-start');
      return Telemetry.span(
        'editor.engine.initialize',
        { sampling: 'perf' },
        async (span) => {
          const module = await loadDocumentSession(span);
          await prepareEditorEngine(module, span);
          perfMark('editor.engine.ready', { engine: 'rust' });
          return module;
        }
      );
    }
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
  props: ParentProps<{
    fallback?: JSX.Element;
    failure?: (retry: () => void) => JSX.Element;
  }>
) {
  const engine = useEditorEngine();
  const retry = () => fireAndForget(engine.retry(), 'editor.engine.retry');
  return (
    <Switch fallback={props.fallback}>
      <Match when={engine.failed()}>{props.failure?.(retry)}</Match>
      <Match when={engine.ready()}>{props.children}</Match>
    </Switch>
  );
}
