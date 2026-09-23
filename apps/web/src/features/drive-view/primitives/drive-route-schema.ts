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

export function driveDocumentBlockType(type: string) {
  if (type === 'task' || type === 'snippet' || type === 'skill') return 'md';
  return type === 'csv' ? 'code' : type;
}
