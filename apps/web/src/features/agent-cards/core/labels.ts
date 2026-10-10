import type { CardAction, CardItemType } from './types';

/** How a card says what the agent did, in the item's own terms. */
export function actionLabel(type: CardItemType, action: CardAction): string {
  if (type === 'calendar_event') {
    return action === 'created' ? 'Scheduled' : 'Updated';
  }
  if (type === 'email_thread') {
    return action === 'sent' ? 'Sent' : 'Updated';
  }
  return action === 'created' ? 'Created' : 'Edited';
}

const DOCUMENT_KINDS: Record<string, string> = {
  md: 'Document',
  txt: 'Document',
  spreadsheet: 'Spreadsheet',
  csv: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  pdf: 'PDF',
  docx: 'Word document',
  doc: 'Word document',
  pptx: 'Presentation',
  canvas: 'Canvas',
  psd: 'Photoshop file',
  fig: 'Figma file',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  svg: 'Image',
  mp4: 'Video',
  mov: 'Video',
  webm: 'Video',
};

/** What kind of document a file type is, as a reader would name it. */
export function documentKind(fileType: string | null | undefined): string {
  return (fileType && DOCUMENT_KINDS[fileType.toLowerCase()]) || 'Document';
}
