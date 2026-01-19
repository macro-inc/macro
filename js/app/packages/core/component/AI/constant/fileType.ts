import type { BlockAlias, BlockName } from '@core/block';
import type { FileType } from '@service-cognition/generated/schemas/fileType';

// Code file extensions from the Rust FileType enum
const codeFileExtensions: (keyof typeof FileType)[] = [
  'py',
  'js',
  'ts',
  'jsx',
  'tsx',
  'json',
  'html',
  'css',
  'xml',
  'yaml',
  'yml',
  'sql',
  'sh',
  'bash',
  'markdown',
  'txt',
  'csv',
] as const;

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
  'canvas',
  'email',
  'task',
  'project',
];
