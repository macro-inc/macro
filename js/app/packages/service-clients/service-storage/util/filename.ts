import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';

const FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS: Array<BlockName | BlockAlias> = [
  'unknown',
  'code',
  'image',
];

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
function _hasExtension(filename: string, extensions: string[]): boolean {
  const extension = fileExtension(filename);
  if (!extension) return false;
  return extensions.some(
    (ext) =>
      ext.toLowerCase() ===
      extension /* we can assume it is lower case from fileExtension */
  );
}

const _reverseFormatDocumentName = (name: string, fileType?: string | null) => {
  if (!fileType) return name;

  const blockName = fileTypeToBlockName(fileType);
  if (!FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS.includes(blockName)) return name;

  const suffix = `.${fileType}`;
  if (!name.endsWith(suffix)) return name;

  return name.substring(0, name.length - suffix.length);
};

/**
 * Appends the file type extension to a document name if it's not already present.
 * @param originalName - The document name to format.
 * @param fileType - The file extension to append (e.g. "mp4", "mov").
 * @param options.fullyQualifiedBlockName - When true, only appends the extension for block types in the fully qualified list (e.g. "unknown", "code").
 * @param options.caseInsensitiveSuffix - When true, treats existing suffixes as matching regardless of case (e.g. "abc.MOV" won't get ".mov" appended).
 */
export const formatDocumentName = (
  originalName: string,
  fileType?: string | null,
  options?: {
    fullyQualifiedBlockName?: boolean;
    caseInsensitiveSuffix?: boolean;
  }
) => {
  if (!fileType) return originalName;

  const blockName = fileTypeToBlockName(fileType);
  if (
    options?.fullyQualifiedBlockName &&
    !FULLY_QUALIFIED_DOCUMENT_NAME_BLOCKS.includes(blockName)
  )
    return originalName;

  const suffix = `.${fileType}`;
  if (originalName.endsWith(suffix)) {
    return originalName;
  }

  if (
    options?.caseInsensitiveSuffix &&
    originalName.toLowerCase().endsWith(suffix.toLowerCase())
  ) {
    return originalName;
  }

  return `${originalName}.${fileType}`;
};
