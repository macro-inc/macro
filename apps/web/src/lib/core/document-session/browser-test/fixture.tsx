import { Access } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createRustEditorSession } from '../create-editor-session';
import {
  EditorEngineBoundary,
  EditorEngineProvider,
  useEditorEngine,
} from '../editor-engine';

function EditorSubtree() {
  const engine = useEditorEngine();
  const [attachment, setAttachment] = createSignal('');
  // A real native factory must be available synchronously when this runs.
  if (engine.enabled() && !engine.module().EditorSession)
    throw new Error('Missing initialized native session factory');
  async function attachSession() {
    const root = document.createElement('div');
    const runtime = createRustEditorSession({
      module: engine.module(),
      root,
      registry: registerMacroElementViews(createBuiltinRegistry()),
      view: {
        namespace: 'durable-factory-fixture',
        theme: {},
        editable: false,
        preset: 'rich',
        onError(error) {
          throw error;
        },
      },
      documentId: crypto.randomUUID(),
      user: 'fixture-user',
      access: Access.Edit,
      authorization: {
        async token() {
          throw new Error('Fixture stays offline');
        },
        subscribe: () => () => {},
      },
      viewEngine: 1,
      viewOs: 0,
      span: NOOP_SPAN,
      onStatus() {},
    });
    // A scoped createEditor factory must receive the actual attachment before
    // returning. There is no temporary model and no microtask before this read.
    if (
      runtime.view.root !== root ||
      !runtime.port ||
      !runtime.executor.session
    )
      throw new Error('Missing synchronous document attachment');
    await runtime.close();
    setAttachment('Durable attachment closed');
  }
  return (
    <>
      <div>Editor subtree ready</div>
      <button onClick={attachSession}>Attach durable session</button>
      <div>{attachment()}</div>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <EditorEngineProvider>
      <div>Application shell ready</div>
      <EditorEngineBoundary
        fallback={<div>Loading editor engine</div>}
        failure={(retry) => (
          <div>
            <span>Editor engine failed</span>
            <button onClick={retry}>Retry</button>
          </div>
        )}
      >
        <EditorSubtree />
      </EditorEngineBoundary>
    </EditorEngineProvider>
  ),
  root
);
