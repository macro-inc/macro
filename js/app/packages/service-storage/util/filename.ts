import { fileTypeToBlockName } from '@core/constant/allBlocks';

const FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS = ['unknown', 'code'];

/**
 * Gets the filename without the extension.
 * @param filename - The filename to get the extension from.
 * @returns The filename without the extension, or the original filename if no extension is found.
 */
export function filenameWithoutExtension(
  filename: string | undefined
): string | undefined {
  if (!filename) return undefined;

  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex === -1 ? filename : filename.substring(0, lastDotIndex);
}

/**
 * Gets the extension of a filename.
 * @param filename - The filename to get the extension from.
 * @returns The extension of the filename, or undefined if no extension is found.
 */
export function fileExtension(
  filename: string | undefined
): string | undefined {
  if (!filename) return undefined;
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex === -1
    ? undefined
    : filename.substring(lastDotIndex + 1).toLowerCase();
}

/**
 * Checks if the filename has a valid extension from the list of allowed extensions.
 * @param filename - The filename to check.
 * @param extensions - An array of allowed extensions.
 * @returns True if the filename has a valid extension, false otherwise.
 */
export function hasExtension(filename: string, extensions: string[]): boolean {
  const extension = fileExtension(filename);
  if (!extension) return false;
  return extensions.some(
    (ext) =>
      ext.toLowerCase() ===
      extension /* we can assume it is lower case from fileExtension */
  );
}

export const reverseFormatDocumentName = (
  name: string,
  fileType?: string | null
) => {
  if (!fileType) return name;

  const blockName = fileTypeToBlockName(fileType);
  if (!FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS.includes(blockName)) return name;

  const suffix = `.${fileType}`;
  if (!name.endsWith(suffix)) return name;

  return name.substring(0, name.length - suffix.length);
};

export const formatDocumentName = (
  originalName: string,
  fileType?: string | null
) => {
  if (!fileType) return originalName;

  const blockName = fileTypeToBlockName(fileType);
  if (!FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS.includes(blockName))
    return originalName;

  const suffix = `.${fileType}`;
  if (originalName.endsWith(suffix)) {
    return originalName;
  }

  return `${originalName}.${fileType}`;
};
