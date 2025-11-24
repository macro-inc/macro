import { type Accessor, onCleanup } from 'solid-js';

interface FileFolderDropDirectiveOptions {
  onDrop?: (
    fileEntries: FileSystemFileEntry[],
    folderEntries: FileSystemDirectoryEntry[],
    e?: DragEvent
  ) => void;
  onDragStart?: (valid: boolean) => void;
  onDragEnd?: () => void;
  onMouseUp?: (x: number, y: number) => void;
  multiple?: boolean;
  disabled?: boolean;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      fileFolderDrop: FileFolderDropDirectiveOptions | undefined;
    }
  }
}

// Helper to convert File to FileSystemFileEntry for HTML-extracted images
function fileToFileSystemFileEntry(file: File): FileSystemFileEntry {
  // Create a minimal FileSystem object (required by FileSystemFileEntry)
  const filesystem = {
    name: '',
    root: null as unknown as FileSystemDirectoryEntry,
  } as FileSystem;

  const entry = {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    filesystem,
    getParent: (
      _successCallback: (entry: FileSystemDirectoryEntry) => void,
      errorCallback?: (error: DOMException) => void
    ) => {
      // For a root-level file, call error callback since there's no parent
      if (errorCallback) {
        errorCallback(new DOMException('No parent directory'));
      }
    },
    file: (
      successCallback: (file: File) => void,
      errorCallback?: (error: DOMException) => void
    ) => {
      try {
        successCallback(file);
      } catch (error) {
        if (errorCallback) {
          const domError =
            error instanceof DOMException
              ? error
              : new DOMException(
                  error instanceof Error ? error.message : String(error)
                );
          errorCallback(domError);
        }
      }
    },
  } satisfies FileSystemFileEntry;
  return entry;
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
      const items = e.dataTransfer?.items;

      // Check if we're dragging an image element (no files in dataTransfer)
      const hasFiles =
        items && Array.from(items).some((item) => item.kind === 'file');

      if (!hasFiles) {
        const types = e.dataTransfer?.types || [];
        // If we have HTML data, it might be an image element
        if (types.includes('text/html')) {
          // Assume valid for now - we'll validate on drop
          options?.onDragStart?.(true);
          return;
        }
        // No files and no HTML - not a valid drag
        options?.onDragStart?.(false);
        return;
      }

      options?.onDragStart?.(true);
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

  const handleDrop = async (e: DragEvent) => {
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
    if (items && items.length > 0) {
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
          dirEntries.push(entry as FileSystemDirectoryEntry);
        }
      }

      if (fileEntries.length > 0 || dirEntries.length > 0) {
        options?.onDrop?.(fileEntries, dirEntries, e);
        return;
      }
    }

    // Fallback to files if items didn't yield results (edge case where webkitGetAsEntry fails)
    const files = dataTransfer.files;
    if (files && files.length > 0) {
      const fileEntries: FileSystemFileEntry[] = Array.from(files).map(
        fileToFileSystemFileEntry
      );
      options?.onDrop?.(fileEntries, [], e);
      return;
    }

    // If no files but we have HTML data, try to extract image URLs
    const html = dataTransfer.getData('text/html');
    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const img = doc.querySelector('img');
      if (img?.src) {
        try {
          // Fetch the image and convert to File
          const response = await fetch(img.src);
          const blob = await response.blob();

          // Extract filename from URL or use default
          let filename = 'image';
          try {
            const url = new URL(img.src);
            const pathname = url.pathname;
            const parts = pathname.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart) {
              filename = lastPart;
            }
          } catch {}

          // Determine extension from blob type
          const extension = blob.type.split('/')[1] || 'png';
          if (!filename.includes('.')) {
            filename = `${filename}.${extension}`;
          }

          const file = new File([blob], filename, { type: blob.type });
          const fileEntry = fileToFileSystemFileEntry(file);
          options?.onDrop?.([fileEntry], [], e);
          return;
        } catch (error) {
          console.error('Failed to fetch dragged image:', error);
        }
      }
    }
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
