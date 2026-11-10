import { createSignal, Show } from 'solid-js';
import { isHtmlFileType } from '../util/fileMode';
import { CodeMirror } from './CodeMirror';
import { HtmlPreview } from './HtmlPreview';

export type CodeBlockMode = 'code' | 'render';

export type CodeContentProps = {
  text: string;
  /** Lets an HTML preview run the file's program blocks as the viewer. */
  documentId?: string;
  fileType?: string | null;
  readOnly: boolean;
  mode: CodeBlockMode;
  onTextChange: (text: string) => void;
  onSave: (text: string) => Promise<void>;
};

/**
 * Prop-driven code document body shared by the legacy block and Drive detail
 * hosts. Host chrome and persistence adapters stay outside this component.
 */
export function CodeContent(props: CodeContentProps) {
  const showHtmlPreview = () =>
    props.mode === 'render' && isHtmlFileType(props.fileType);
  // The preview builds the saved source, so it waits for the editor's last
  // save (the one it makes as it closes, on a switch to Render) and builds
  // again after each.
  const [savesInFlight, setSavesInFlight] = createSignal(0);
  const [savedVersion, setSavedVersion] = createSignal(0);
  const save = async (text: string) => {
    setSavesInFlight((count) => count + 1);
    try {
      await props.onSave(text);
      setSavedVersion((version) => version + 1);
    } finally {
      setSavesInFlight((count) => count - 1);
    }
  };

  return (
    <Show
      when={showHtmlPreview()}
      fallback={
        <CodeMirror
          text={props.text}
          fileType={props.fileType}
          readOnly={props.readOnly}
          onTextChange={props.onTextChange}
          onSave={save}
        />
      }
    >
      <HtmlPreview
        text={props.text}
        documentId={props.documentId}
        saving={savesInFlight() > 0}
        savedVersion={savedVersion()}
      />
    </Show>
  );
}
