import { Show } from 'solid-js';
import { isHtmlFileType } from '../util/fileMode';
import { CodeMirror } from './CodeMirror';
import { HtmlPreview } from './HtmlPreview';

export type CodeBlockMode = 'code' | 'render';

export type CodeContentProps = {
  text: string;
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

  return (
    <Show
      when={showHtmlPreview()}
      fallback={
        <CodeMirror
          text={props.text}
          fileType={props.fileType}
          readOnly={props.readOnly}
          onTextChange={props.onTextChange}
          onSave={props.onSave}
        />
      }
    >
      <HtmlPreview text={props.text} />
    </Show>
  );
}
