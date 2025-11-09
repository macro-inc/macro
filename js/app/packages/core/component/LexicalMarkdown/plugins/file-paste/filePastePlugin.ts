import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';

type ImagePastePluginProps = {
  onPaste: (files: File[]) => void;
};

function registerFilePastePlugin(
  editor: LexicalEditor,
  props: ImagePastePluginProps
) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (event instanceof ClipboardEvent) {
          const files = Array.from(event.clipboardData?.files || []);
          if (files.length > 0) {
            props.onPaste(files);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function filePastePlugin(props: ImagePastePluginProps) {
  return (editor: LexicalEditor) => registerFilePastePlugin(editor, props);
}
