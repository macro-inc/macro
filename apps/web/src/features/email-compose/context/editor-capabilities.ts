import type { LexicalEditor } from 'lexical';
export interface ComposeBodyActions {
  focusSibling?: (direction: 'next' | 'prev') => boolean | void;
  recipientAdded(email: string): void;
  readDroppedFiles(
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[],
    onFiles: (files: File[]) => void
  ): void;
  pasteFiles(
    editor: LexicalEditor,
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ): void;
}
