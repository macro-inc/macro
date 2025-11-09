import { toast } from '@core/component/Toast/Toast';
import { fileExtension } from '@service-storage/util/filename';
import { type Accessor, onCleanup } from 'solid-js';

interface FileDropDirectiveOptions {
  disabled?: boolean;
  onDrop?: (files: File[], e: DragEvent) => void;
  onDragStart?: (valid: boolean) => void;
  onDragEnd?: () => void;
  onMouseUp?: (x: number, y: number) => void;
  acceptedMimeTypes?: string[];
  acceptedFileExtensions?: string[];
  multiple?: boolean;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      fileDrop: FileDropDirectiveOptions | undefined;
    }
  }
}

export function fileDrop(
  element: HTMLElement,
  accessor: Accessor<FileDropDirectiveOptions | undefined>
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
      const acceptedFileExtensions = options?.acceptedFileExtensions;
      const hasExtensions =
        acceptedFileExtensions && acceptedFileExtensions.length > 0;

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

      // NOTE: mime type alone is not enough to determine if a file is valid iff there are no extensions specified
      // this is because file name is not available on drag enter event, only on drop
      if (!hasExtensions && items && items.length > 0) {
        const invalidItems = Array.from(items).filter((item) => {
          if (item.kind === 'file') {
            const type = item.type;
            const fileValid = isFileValid({ type });
            return fileValid === false;
          } else {
            return true;
          }
        });

        if (invalidItems.length > 0) {
          options?.onDragStart?.(false);
          return;
        }
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

  const isFileTypeValid = (fileType?: string): boolean | undefined => {
    if (!fileType) {
      return undefined;
    }

    const acceptedMimeTypes = accessor()?.acceptedMimeTypes;
    if (acceptedMimeTypes) {
      return acceptedMimeTypes.includes(fileType);
    }
    return undefined;
  };

  const isFileExtensionValid = (extension?: string): boolean | undefined => {
    if (!extension) {
      return undefined;
    }

    const acceptedFileExtensions = accessor()?.acceptedFileExtensions;
    if (acceptedFileExtensions) {
      return acceptedFileExtensions.includes(extension);
    }
    return undefined;
  };

  const isFileValid = ({ type, name }: { type?: string; name?: string }) => {
    let fileTypeValid = isFileTypeValid(type);

    const extension = fileExtension(name);
    const extensionValid = isFileExtensionValid(extension);

    if (fileTypeValid || extensionValid) {
      return true;
    }
    if (fileTypeValid === undefined && extensionValid === undefined) {
      return true;
    }

    return false;
  };

  const handleDrop = async (e: DragEvent) => {
    if (accessor()?.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;

    const options = accessor();
    options?.onDragEnd?.();
    options?.onMouseUp?.(e.pageX, e.pageY);

    // Check for directories using dataTransfer.items
    const items = e.dataTransfer?.items;
    if (items && items.length > 0) {
      let hasDirectory = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry?.isDirectory) {
            hasDirectory = true;
            break;
          }
        }
      }

      if (hasDirectory) {
        toast.failure('Folder upload not supported here');
        return;
      }
    }

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const validFiles = Array.from(files).filter(isFileValid);
      const valid = validFiles.length === files.length;
      if (!valid) {
        toast.failure('Invalid attachment file(s)');
        return;
      }
      options?.onDrop?.(validFiles, e);
      return;
    }

    // If no files but we have HTML data, try to extract image URLs
    const html = e.dataTransfer?.getData('text/html');
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

          if (isFileValid(file)) {
            options?.onDrop?.([file], e);
            return;
          }
        } catch (error) {
          console.error('Failed to fetch dragged image:', error);
        }
      }
    }

    toast.failure('Invalid attachment file(s)');
  };

  let input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.accept =
    accessor()?.acceptedMimeTypes?.join(',') +
    ',.' +
    accessor()?.acceptedFileExtensions?.join(',.');
  input.multiple = accessor()?.multiple ?? false;

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
