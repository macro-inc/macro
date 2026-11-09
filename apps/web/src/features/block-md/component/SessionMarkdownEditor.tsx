import { FocusClickTarget } from '@core/component/LexicalMarkdown/component/core/FocusClickTarget';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { createSignal } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { MarkdownEditorChrome } from './MarkdownEditorChrome';
import RustMarkdownEditor from './RustMarkdownEditor';

/** Session adapter supplies the engine to the same document body chrome. */
export default function SessionMarkdownEditor(props: {
  context: SyncDocumentOpenContext;
  autoFocus: boolean;
  onReady?: () => void;
}) {
  const { permissions, state } = useMarkdownDocument();
  const [ready, setReady] = createSignal(false);
  const [empty, setEmpty] = createSignal(false);
  const [error, setError] = createSignal<string>();
  return (
    <MarkdownEditorChrome
      ready={ready()}
      empty={empty()}
      canEdit={permissions.canEdit()}
      error={error()}
      body={
        <RustMarkdownEditor
          context={props.context}
          autoFocus={props.autoFocus}
          onReady={() => {
            setReady(true);
            props.onReady?.();
          }}
          onEmptyChange={setEmpty}
          onRuntime={(runtime) => state.editor.setMd('nativeRuntime', runtime)}
          onError={() =>
            setError(
              'The document editor could not open. Reopen the document to retry.'
            )
          }
        />
      }
      focusTarget={
        <FocusClickTarget
          style={{ height: '80px' }}
          native={{
            editable: permissions.canEdit,
            hasSelection() {
              const selection =
                state.editor.md.nativeRuntime?.view.selection().selection;
              return (
                selection?.kind === 'range' &&
                (selection.anchor.key !== selection.focus.key ||
                  selection.anchor.offset !== selection.focus.offset)
              );
            },
            focusAtEnd() {
              const runtime = state.editor.md.nativeRuntime;
              if (!runtime?.editing) return;
              if (
                runtime.view.root.contains(document.activeElement) &&
                runtime.view.selection().selection.kind === 'range'
              )
                return;
              runtime.editing.focus.appendEmptyParagraph();
            },
          }}
        />
      }
    />
  );
}
