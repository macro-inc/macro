import { FileTypeMap } from '@service-storage/fileTypeMap';

function fileExtension(filename: string): string | undefined {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex === -1
    ? undefined
    : filename.substring(lastDotIndex + 1).toLowerCase();
}

export function resolveUploadContentType(file: {
  name: string;
  mimeType?: string;
  type?: string;
}): string | undefined {
  const explicitType = file.mimeType || file.type;
  if (explicitType && explicitType !== 'application/octet-stream') {
    return explicitType;
  }

  const ext = fileExtension(file.name);
  if (!ext) return explicitType || undefined;

  return (
    FileTypeMap[ext as keyof typeof FileTypeMap]?.mime ||
    explicitType ||
    undefined
  );
}
