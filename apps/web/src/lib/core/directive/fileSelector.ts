import { type Accessor, onCleanup } from 'solid-js';

interface FileSelectorProps {
  onSelect: (files: File[]) => void;
  acceptedMimeTypes?: string[];
  acceptedFileExtensions?: string[];
  multiple?: boolean;
  id?: string;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      fileSelector: FileSelectorProps | undefined;
    }
  }
}

export function fileSelector(
  element: HTMLElement,
  accessor: Accessor<FileSelectorProps | undefined>
) {
  const isFileTypeValid = (file: File) => {
    if (file.type && accessor()?.acceptedMimeTypes?.includes(file.type)) {
      return true;
    }

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension && accessor()?.acceptedFileExtensions?.includes(extension)) {
      return true;
    }

    // If no mime types or file extensions are provided, allow all files
    if (!accessor()?.acceptedMimeTypes && !accessor()?.acceptedFileExtensions) {
      return true;
    }

    return false;
  };

  // Each click opens a picker on its own input. This setup can run again
  // while a picker is open (a Button's tooltip re-runs its ref when it opens
  // or closes), so the input must not be replaced or unhooked by a cleanup.
  //
  // The input stays in the document until the picker answers. WebKit drops
  // the picker's result when it garbage-collects a detached input while the
  // picker is open, which the iOS app's photo and file pickers give it time
  // to do, so the picked files would vanish without an error.
  const clickInput = (e: MouseEvent) => {
    e.stopPropagation();
    const options = accessor();
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.id) {
      input.id = options.id;
    }
    input.style.display = 'none';
    const mimeTypes = options?.acceptedMimeTypes?.join(',');
    const fileExtensions = options?.acceptedFileExtensions?.join(',.');
    let acceptString = '';
    if (mimeTypes) {
      acceptString += `${mimeTypes},`;
    }
    if (fileExtensions) {
      acceptString += `.${fileExtensions}`;
    }
    input.accept = acceptString;
    input.multiple = options?.multiple ?? false;
    // Keep the input's own click away from document-level handlers.
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('cancel', () => input.remove());
    input.addEventListener('change', () => {
      input.remove();
      // The control was removed while the picker was open.
      if (!element.isConnected) return;
      const validFiles = Array.from(input.files || []).filter(isFileTypeValid);
      if (validFiles.length > 0) {
        accessor()?.onSelect(validFiles);
      }
    });
    document.body.append(input);
    input.click();
  };

  element.addEventListener('click', clickInput);

  onCleanup(() => {
    element.removeEventListener('click', clickInput);
  });
}
