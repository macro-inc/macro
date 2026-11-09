import { ErrorBoundary } from 'solid-js';
import { render } from 'solid-js/web';
import {
  EditorEngineBoundary,
  EditorEngineProvider,
  useEditorEngine,
} from '../editor-engine';

function EditorSubtree() {
  const engine = useEditorEngine();
  // A real native factory must be available synchronously when this runs.
  if (engine.enabled() && !engine.module().EditorSession)
    throw new Error('Missing initialized native session factory');
  return <div>Editor subtree ready</div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <EditorEngineProvider>
      <div>Application shell ready</div>
      <ErrorBoundary fallback={<div>Editor engine failed</div>}>
        <EditorEngineBoundary fallback={<div>Loading editor engine</div>}>
          <EditorSubtree />
        </EditorEngineBoundary>
      </ErrorBoundary>
    </EditorEngineProvider>
  ),
  root
);
