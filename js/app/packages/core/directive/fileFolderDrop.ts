import { toast } from '@core/component/Toast/Toast';
import { type Accessor, onCleanup } from 'solid-js';

interface FileFolderDropDirectiveOptions {
  onDrop?: (
    fileEntries: FileSystemFileEntry[],
    folderEntries: FileSystemDirectoryEntry[],
    e?: DragEvent
  ) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onMouseUp?: (x: number, y: number) => void;
  multiple?: boolean;
  folder?: boolean;
  disabled?: boolean;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      fileFolderDrop: FileFolderDropDirectiveOptions | undefined;
    }
  }
}

// differs from fileDrop in that it handles both files and folders
export function fileFolderDrop(
  element: HTMLElement,
  accessor: Accessor<FileFolderDropDirectiveOptions | undefined>
) {
  let dragCounter = 0;

  const handleDragOver = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;

    if (dragCounter === 1) {
      const options = accessor();
      options?.onDragStart?.();
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;

    if (dragCounter === 0) {
      const options = accessor();
      options?.onDragEnd?.();
    }
  };

  const handleDrop = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();

    const options = accessor();
    dragCounter = 0;
    options?.onDragEnd?.();
    options?.onMouseUp?.(e.pageX, e.pageY);

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) {
      return;
    }

    const items = dataTransfer.items;
    if (!items || items.length === 0) return;

    let fileEntries: FileSystemFileEntry[] = [];
    let dirEntries: FileSystemDirectoryEntry[] = [];

    for (const item of items) {
      if (item.kind !== 'file') continue;

      const entry = item.webkitGetAsEntry();
      if (!entry) {
        continue;
      }

      if (entry.isFile) {
        fileEntries.push(entry as FileSystemFileEntry);
      } else if (entry.isDirectory) {
        if (!options?.folder) {
          toast.failure('Folder upload is disabled');
          return;
        }

        dirEntries.push(entry as FileSystemDirectoryEntry);
      }
    }

    options?.onDrop?.(fileEntries, dirEntries, e);

    return;
  };

  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('dragenter', handleDragEnter);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('drop', handleDrop);

  onCleanup(() => {
    element.removeEventListener('dragover', handleDragOver);
    element.removeEventListener('dragenter', handleDragEnter);
    element.removeEventListener('dragleave', handleDragLeave);
    element.removeEventListener('drop', handleDrop);
  });
}
