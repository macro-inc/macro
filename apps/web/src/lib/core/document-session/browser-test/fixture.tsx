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
