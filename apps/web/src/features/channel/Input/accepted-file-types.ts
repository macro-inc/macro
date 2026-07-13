export const CHANNEL_IMAGE_FILE_EXTENSIONS = [
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
] as const;

export const CHANNEL_VIDEO_FILE_EXTENSIONS = [
  'avi',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'webm',
] as const;

export const CHANNEL_DOCUMENT_FILE_EXTENSIONS = [
  'canvas',
  'csv',
  'doc',
  'docx',
  'json',
  'md',
  'pdf',
  'ppt',
  'pptx',
  'rtf',
  'txt',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
] as const;

export const CHANNEL_ACCEPTED_FILE_EXTENSIONS = [
  ...CHANNEL_IMAGE_FILE_EXTENSIONS,
  ...CHANNEL_VIDEO_FILE_EXTENSIONS,
  ...CHANNEL_DOCUMENT_FILE_EXTENSIONS,
] as const;

export const CHANNEL_FILE_PICKER_ACCEPT = CHANNEL_ACCEPTED_FILE_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(',');
