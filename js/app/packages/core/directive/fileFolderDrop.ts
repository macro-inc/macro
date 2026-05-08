import { internalDragExceedsThreshold } from '@core/directive/internalDragState';
import { extractFileSystemEntries } from '@core/util/dataTransfer';
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

// Helper to convert File to FileSystemFileEntry for HTML-extracted images if webkitGetAsEntry fails
// We only need to shim the file() method
function fileToFileSystemFileEntry(file: File): FileSystemFileEntry {
  return {
    file: (successCallback, _errorCallback) => {
      return successCallback(file);
    },
  } as FileSystemFileEntry;
}

// differs from fileDrop in that it handles both files and folders
export function fileFolderDrop(
  element: HTMLElement,
  accessor: Accessor<FileFolderDropDirectiveOptions | undefined>
) {
  let dragCounter = 0;
  let internalDragActivated = false;

  const handleDragOver = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();

    // Upgrade an internal drag to active once the 20px threshold is exceeded.
    if (
      !internalDragActivated &&
      e.dataTransfer?.types.includes('application/x-macro-internal') &&
      internalDragExceedsThreshold()
    ) {
      internalDragActivated = true;
      accessor()?.onDragStart?.(true);
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;

    if (dragCounter === 1) {
      const options = accessor();
      const items = e.dataTransfer?.items;

      // Mark drag start call back as valid if we're dragging a file.
      const hasFiles =
        items && Array.from(items).some((item) => item.kind === 'file');

      if (!hasFiles) {
        const types = e.dataTransfer?.types || [];
        // For internal image drags, wait for the 20px threshold before activating.
        // handleDragOver will upgrade to valid once the threshold is exceeded.
        if (types.includes('application/x-macro-internal')) {
          internalDragActivated = false;
          options?.onDragStart?.(false);
          return;
        }
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
      internalDragActivated = false;
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
    internalDragActivated = false;
    options?.onDragEnd?.();
    options?.onMouseUp?.(e.pageX, e.pageY);

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) {
      return;
    }

    const { fileEntries, directoryEntries } =
      extractFileSystemEntries(dataTransfer);

    // If directories present, prefer directories to avoid duplicate phantom files, which result from selecting a folder and it's contents (e.g. in a list view with the folder toggled open), thus uploading both the directory (and all of its contents) and the contents separately.
    if (directoryEntries.length > 0) {
      options?.onDrop?.([], directoryEntries, e);
      return;
    }

    if (fileEntries.length > 0) {
      options?.onDrop?.(fileEntries, [], e);
      return;
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

    // If no files but we have HTML data, try to extract image URLs.
    // For internal drags, only proceed if the drag exceeded the 20px threshold.
    if (dataTransfer.types.includes('application/x-macro-internal')) {
      if (!internalDragExceedsThreshold()) {
        return;
      }
    }

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
