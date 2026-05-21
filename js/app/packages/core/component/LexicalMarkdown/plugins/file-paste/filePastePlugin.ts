import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  extractFileSystemEntries,
  readImageEntriesFromAsyncClipboard,
} from '@core/util/dataTransfer';
import { mergeRegister } from '@lexical/utils';
import { isAndroid, isIOS } from '@solid-primitives/platform';
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

function isMobilePasteContext(): boolean {
  return isIOS || isAndroid || isNativeMobilePlatform();
}

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
          // On mobile (notably iOS Safari) clipboard image data is often
          // unreachable through the synchronous ClipboardEvent — recover it
          // via the async Clipboard API. Kick off without awaiting so the
          // paste event's user-activation propagates to navigator.clipboard.
          if (isMobilePasteContext()) {
            void readImageEntriesFromAsyncClipboard().then((entries) => {
              if (entries.length > 0) {
                props.onPasteFilesAndDirs(entries, []);
              }
            });
          }
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
