import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';

type FilePastePluginProps = {
  onPasteFiles?: (files: File[]) => void;
  onPasteFilesAndDirs?: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
};

function isFileSystemFileEntry(
  entry: FileSystemEntry
): entry is FileSystemFileEntry {
  return entry.isFile;
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

        const items = Array.from(data.items || []);
        const filesFromClipboard = Array.from(data.files || []);
        const fileEntries: FileSystemFileEntry[] = [];
        const directoryEntries: FileSystemDirectoryEntry[] = [];
        for (const item of items) {
          if (item.kind !== 'file') continue;
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry && entry.isDirectory) {
            directoryEntries.push(entry as FileSystemDirectoryEntry);
          } else if (entry && isFileSystemFileEntry(entry)) {
            fileEntries.push(entry);
          }
        }

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

        // Backwards compatibility: fall back to files list (no directory support)
        if (props.onPasteFiles) {
          if (filesFromClipboard.length > 0) {
            props.onPasteFiles(filesFromClipboard);
            return true;
          }
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
