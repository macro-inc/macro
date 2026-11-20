import { isPlatform } from '@core/util/platform';

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
  'xlsm',
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

/**
 * The channel file picker's `accept` filter, or none in the desktop app.
 *
 * In the macOS desktop app (Chromium) a picker carrying this extension list
 * attaches nothing, whatever the file type, while the agent composer's
 * unfiltered picker works in the same app. Drops and pastes into the composer
 * were never filtered and the uploads take any file, so the desktop picker
 * goes unfiltered too.
 */
export function channelFilePickerAccept(): string | undefined {
  return isPlatform('desktop') ? undefined : CHANNEL_FILE_PICKER_ACCEPT;
}

/** Sets a file input's `accept`, removing the attribute for no filter. */
export function setFilePickerAccept(
  input: HTMLInputElement,
  accept: string | undefined
) {
  if (accept === undefined) input.removeAttribute('accept');
  else input.accept = accept;
}
