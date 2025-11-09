import { type Accessor, type JSX, onCleanup } from 'solid-js';

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

  const handleFileInputChange: JSX.ChangeEventHandlerUnion<
    HTMLInputElement,
    Event
  > = (e) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(isFileTypeValid);

    if (validFiles.length > 0) {
      accessor()?.onSelect(validFiles);
    }
  };

  let options = accessor();
  let input = document.createElement('input');
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

  const clickInput = (e: MouseEvent) => {
    e.stopPropagation();
    input.click();
  };

  input.addEventListener('change', handleFileInputChange);
  element.addEventListener('click', clickInput);

  onCleanup(() => {
    input.removeEventListener('change', handleFileInputChange);
    element.removeEventListener('click', clickInput);
  });
}
