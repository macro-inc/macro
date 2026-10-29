/**
 * Imperative file and folder pickers. Kept apart from the upload module so a
 * caller that only needs the picker does not load the upload pipeline.
 */

import { fireAndForget } from '@core/util/fireAndForget';

type UploadPickerCleanup = () => void;

type UploadPickerOptions = {
  multiple?: boolean;
  acceptedMimeTypes?: string[];
  acceptedFileExtensions?: string[];
  directory?: boolean;
  filterDotfiles?: boolean;
};

function buildAcceptString(options?: UploadPickerOptions): string {
  const mimeTypes = options?.acceptedMimeTypes?.join(',');
  const fileExtensions = options?.acceptedFileExtensions?.join(',.');
  let acceptString = '';
  if (mimeTypes) {
    acceptString += `${mimeTypes},`;
  }
  if (fileExtensions) {
    acceptString += `.${fileExtensions}`;
  }
  return acceptString;
}

function filterFilesFromInput(
  fileList: FileList | null,
  options?: UploadPickerOptions
): File[] {
  const filterDotfiles = options?.filterDotfiles ?? true;
  const files = Array.from(fileList || []);
  return filterDotfiles ? files.filter((f) => !f.name.startsWith('.')) : files;
}

function createHiddenFileInput(
  options?: UploadPickerOptions
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.multiple = options?.multiple ?? false;
  input.accept = buildAcceptString(options);

  // Enable folder picking in browsers that support it (Safari/Chrome/WebKit)
  if (options?.directory) {
    // property exists in TS lib for WebKit dir inputs on some setups
    (
      input as HTMLInputElement & { webkitdirectory?: boolean }
    ).webkitdirectory = true;
    // ensure attribute is present for environments that rely on it
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }

  return input;
}

/**
 * Imperative picker for files/folders, using a hidden <input type="file" />.
 * Returns a cleanup function; you generally don't need it because the util
 * removes listeners and DOM nodes once a selection is made.
 */
function openUploadPicker(
  options: UploadPickerOptions,
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  const input = createHiddenFileInput(options);

  const handleChange = () => {
    const files = filterFilesFromInput(input.files, options);
    // Always cleanup before invoking callback to avoid re-entrancy leaks
    cleanup();
    // Only call onSelect if there are files selected
    if (files.length > 0) {
      fireAndForget(onSelect(files), 'file-upload');
    }
  };

  const cleanup = () => {
    input.removeEventListener('change', handleChange);
    input.remove();
  };

  input.addEventListener('change', handleChange);
  document.body.appendChild(input);
  input.click();

  return cleanup;
}

export function openFilePicker(
  options: Omit<UploadPickerOptions, 'directory'> = {},
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  return openUploadPicker(
    {
      ...options,
      directory: false,
    },
    onSelect
  );
}

export function openFolderPicker(
  options: Omit<UploadPickerOptions, 'directory'> = {},
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  return openUploadPicker(
    {
      ...options,
      directory: true,
      multiple: options.multiple ?? true,
    },
    onSelect
  );
}
