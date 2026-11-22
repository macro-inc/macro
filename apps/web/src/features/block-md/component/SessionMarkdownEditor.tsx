import { FocusClickTarget } from '@core/component/LexicalMarkdown/component/core/FocusClickTarget';
import { getErrorDescription } from '@core/component/LexicalMarkdown/constants';
import { createNativeFocusTarget } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-focus';
import { EditorEngineBoundary } from '@core/document-session/editor-engine';
import { MessageLoadError } from '@core/messages/MessageLoadError';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { createSignal } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { MarkdownEditorChrome } from './MarkdownEditorChrome';
import RustMarkdownEditor from './RustMarkdownEditor';

/** Session adapter supplies the engine to the same document body chrome. */
export default function SessionMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
  onReady?: () => void;
}) {
  const { permissions, state } = useMarkdownDocument();
  const [ready, setReady] = createSignal(false);
  const [empty, setEmpty] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [container, setContainer] = createSignal<HTMLDivElement>();
  return (
    <MarkdownEditorChrome
      connectContainer={setContainer}
      ready={ready()}
      empty={empty()}
      canEdit={permissions.canEdit()}
      error={(() => {
        const editorError = state.editor.error();
        return editorError ? getErrorDescription(editorError) : error();
      })()}
      body={
        // Paste preparation must finish before the editor accepts input.
        <EditorEngineBoundary
          failure={(retry) => (
            <MessageLoadError onRetry={retry}>
              Could not open this content.
            </MessageLoadError>
          )}
        >
          <RustMarkdownEditor
            context={props.context}
            container={container}
            loadCachedSnapshot={props.loadCachedSnapshot}
            autoFocus={props.autoFocus}
            onReady={() => {
              setReady(true);
              props.onReady?.();
            }}
            onEmptyChange={setEmpty}
            onRuntime={(runtime) =>
              state.editor.setMd('nativeRuntime', runtime)
            }
            onError={() =>
              setError(
                'The document editor could not open. Reopen the document to retry.'
              )
            }
          />
        </EditorEngineBoundary>
      }
      focusTarget={
        <FocusClickTarget
          style={{ height: '80px' }}
          native={createNativeFocusTarget(
            () => state.editor.md.nativeRuntime,
            permissions.canEdit
          )}
        />
      }
    />
  );
}
