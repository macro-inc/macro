export const DRIVE_DOCUMENT_TYPES = [
  'md',
  'task',
  'skill',
  'snippet',
  'canvas',
  'pdf',
  'code',
  'csv',
  'image',
  'video',
  'spreadsheet',
  'unknown',
] as const;

export type DriveDocumentType = (typeof DRIVE_DOCUMENT_TYPES)[number];

/**
 * Everything Drive opens inline. Databases and forms open here only from
 * Drive itself: their links keep their own routes rather than redirecting.
 */
export const DRIVE_DETAIL_TYPES = [
  ...DRIVE_DOCUMENT_TYPES,
  'database',
  'form',
] as const;

export type DriveDetailType = (typeof DRIVE_DETAIL_TYPES)[number];

export function driveDocumentBlockType(type: string) {
  if (type === 'task' || type === 'snippet' || type === 'skill') return 'md';
  return type === 'csv' ? 'code' : type;
}
