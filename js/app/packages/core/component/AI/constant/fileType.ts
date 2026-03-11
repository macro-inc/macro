import type { BlockAlias, BlockName } from '@core/block';
import { FileType } from '@service-cognition/generated/schemas/fileType';
import { FileTypeMap } from '@service-storage/fileTypeMap';

function isFileType(k: string): k is FileType {
  return k in FileType;
}

// Code file extensions from the Rust FileType enum
const codeFileExtensions: (keyof typeof FileType)[] = Object.entries(
  FileTypeMap
)
  .filter(([_, o]) => o.mime === 'text/plain')
  .map(([ext, _]) => ext)
  .filter(isFileType);

// these will be converted to a supported format before upload
const CONVERSION_SUPPORTED_IMAGE_EXTENSIONS = ['heic', 'heif'] as const;

// Image extensions from the Rust FileType enum
export const SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'svg',
  'webp',
  ...CONVERSION_SUPPORTED_IMAGE_EXTENSIONS,
];

export const SUPPORTED_DOCUMENT_ATTACHMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'md',
  'canvas',
  ...codeFileExtensions,
];

export const SUPPORTED_ATTACHMENT_EXTENSIONS = [
  ...SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS,
  ...SUPPORTED_DOCUMENT_ATTACHMENT_EXTENSIONS,
];

export const SUPPORTED_CHAT_ATTACHMENT_BLOCKS: (BlockName | BlockAlias)[] = [
  'image',
  'channel',
  'write',
  'pdf',
  'md',
  'code',
  'csv',
  'canvas',
  'email',
  'task',
  'project',
];
