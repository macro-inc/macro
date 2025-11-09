import { fileExtension } from '@service-storage/util/filename';
import { FileSystemError } from './error';

export function filenameFromPath(path: string) {
  const filename = path.split('\\')?.pop()?.split('/')?.pop();
  if (!filename) {
    throw new FileSystemError(`Unable to get filename from path: ${path}`);
  }
  return filename;
}

/**
 * removes a file extension from given path or file name
 */
export function replaceExtension(path: string, newExt: string) {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex === -1) {
    return `${path}.${newExt}`;
  }
  return `${path.slice(0, dotIndex)}.${newExt}`;
}

/**
 * @param filename - the filename to replace the extension of
 * @param toExtension - the new extension to replace the old one with
 * @param omitIfExtensionMissing - if true, the extension will not be replaced if the filename does not have an extension
 * @returns the filename with the new extension
 */
export const replaceFileExtension = ({
  filename,
  toExtension,
  omitIfExtensionMissing,
}: {
  filename: string;
  toExtension: string;
  omitIfExtensionMissing?: boolean;
}): string => {
  const hasExtension = filename.includes('.');
  if (omitIfExtensionMissing && !hasExtension) {
    return filename;
  }
  return replaceExtension(filename, toExtension);
};

/** Utility method for adding an extension to a filename if it doesn't yet exist */
export const getFileNameWithExtension = (
  fileName: string,
  fileType: string
): string => {
  let ext = fileExtension(fileName) ?? `${fileName}.${fileType}`;

  if (ext !== fileType) {
    return `${fileName}.${fileType}`;
  }

  return fileName;
};
