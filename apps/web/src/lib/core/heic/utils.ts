import { HEIC_EXTENSIONS, HEIC_MIME_TYPES, IMAGE_FORMATS } from './constants';

/**
 * Utility functions for file type detection
 */

// NOTE: duplicate from @service-storage/util/filename
/**
 * Gets the extension of a filename.
 * @param filename - The filename to get the extension from.
 * @returns The extension of the filename, or undefined if no extension is found.
 */
function fileExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex === -1
    ? undefined
    : filename.substring(lastDotIndex + 1).toLowerCase();
}

/**
 * Check if a file is a HEIC/HEIF file based on extension and MIME type
 */
export function isHeicFile(file: File): boolean {
  const extension = fileExtension(file.name);
  const hasHeicExtension =
    extension && HEIC_EXTENSIONS.includes(extension as any);
  const hasHeicMimeType = HEIC_MIME_TYPES.includes(file.type as any);

  return Boolean(hasHeicExtension || hasHeicMimeType);
}

export async function checkWebCodecsSupport(
  mimeType: string
): Promise<boolean> {
  if (!globalThis.ImageDecoder?.isTypeSupported) {
    return false;
  }

  try {
    return globalThis.ImageDecoder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

/**
 * Generate output filename for converted HEIC file
 */
export function generateConvertedFilename(
  originalFilename: string,
  targetFormat: string = IMAGE_FORMATS.PNG
): string {
  const baseName = originalFilename.replace(/\.(heic|heif)$/i, '');
  const extension = targetFormat === IMAGE_FORMATS.PNG ? 'png' : 'jpg';
  return `${baseName}.${extension}`;
}
