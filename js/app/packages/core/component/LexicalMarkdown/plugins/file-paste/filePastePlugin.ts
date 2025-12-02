import { extractFileSystemEntries } from '@core/util/dataTransfer';
import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';

type FilePastePluginProps = {
  onPasteFilesAndDirs?: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
};

function registerFilePastePlugin(
  editor: LexicalEditor,
  props: FilePastePluginProps
) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (!(event instanceof ClipboardEvent)) return false;

        const data = event.clipboardData;
        if (!data) return false;

        const { fileEntries, directoryEntries } =
          extractFileSystemEntries(data);

        if (fileEntries.length === 0 && directoryEntries.length === 0) {
          return false;
        }

        // Prefer new API when provided
        if (props.onPasteFilesAndDirs) {
          // If folders present, prefer directories to avoid duplicate phantom files
          if (directoryEntries.length > 0) {
            props.onPasteFilesAndDirs([], directoryEntries);
            return true;
          }
          props.onPasteFilesAndDirs(fileEntries, []);
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function filePastePlugin(props: FilePastePluginProps) {
  return (editor: LexicalEditor) => registerFilePastePlugin(editor, props);
}
