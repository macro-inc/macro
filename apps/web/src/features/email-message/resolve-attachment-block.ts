import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { FileTypeMap } from '@service-storage/fileTypeMap';

function extensionFromFilename(filename?: string | null): string | undefined {
  if (!filename) return;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension || extension === filename.toLowerCase()) return;
  return extension;
}

function extensionFromMime(mimeType?: string | null): string | undefined {
  if (!mimeType) return;
  // Prefer the first matching extension so shared MIME types (e.g.
  // application/postscript → ai/eps/ps) resolve to the primary mapping.
  return Object.values(FileTypeMap).find((type) => type.mime === mimeType)
    ?.extension;
}

/**
 * Resolve which block should open an email attachment.
 *
 * Filename wins over stored document type and MIME: email providers often
 * send ambiguous MIME (application/postscript, application/octet-stream)
 * that would otherwise map .ai files to an unviewable type.
 */
export function resolveEmailAttachmentBlockName(args: {
  filename?: string | null;
  mimeType?: string | null;
  documentFileType?: string | null;
}): BlockName | BlockAlias {
  const fileType =
    extensionFromFilename(args.filename) ??
    args.documentFileType ??
    extensionFromMime(args.mimeType);

  return fileTypeToBlockName(fileType);
}
