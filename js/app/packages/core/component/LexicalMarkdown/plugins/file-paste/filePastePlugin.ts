import {
  recoverMobileClipboardImageEntries,
  shouldUseMobileClipboardImageRecovery,
} from '@core/mobile/mobileClipboardImageRecovery';
import { extractFileSystemEntries } from '@core/util/dataTransfer';
import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';

type FilePastePluginProps = {
  onPasteFilesAndDirs: (
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

        if (
          directoryEntries.length === 0 &&
          shouldUseMobileClipboardImageRecovery(data)
        ) {
          event.preventDefault();
          void recoverMobileClipboardImageEntries().then((entries) => {
            if (entries.length > 0) {
              props.onPasteFilesAndDirs(entries, []);
            } else if (fileEntries.length > 0) {
              props.onPasteFilesAndDirs(fileEntries, []);
            }
          });
          return true;
        }

        if (fileEntries.length === 0 && directoryEntries.length === 0) {
          return false;
        }

        // If directories present, prefer directories to avoid duplicate phantom files, which result from selecting a folder and it's contents (e.g. in a list view with the folder toggled open), th us uploading both the directory (and all of its contents) and the contents separately.
        if (directoryEntries.length > 0) {
          props.onPasteFilesAndDirs([], directoryEntries);
          return true;
        }
        props.onPasteFilesAndDirs(fileEntries, []);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function filePastePlugin(props: FilePastePluginProps) {
  return (editor: LexicalEditor) => registerFilePastePlugin(editor, props);
}
