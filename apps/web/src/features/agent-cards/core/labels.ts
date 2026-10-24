import { match } from 'ts-pattern';
import type { CardAction, CardItemType } from './types';

/** How a card says what the agent did, in the item's own terms. */
export function actionLabel(type: CardItemType, action: CardAction): string {
  return match(action)
    .with('created', () =>
      type === 'calendar_event' ? 'Scheduled' : 'Created'
    )
    .with('sent', () => (type === 'channel' ? 'Posted' : 'Sent'))
    .with('edited', () => (type === 'calendar_event' ? 'Updated' : 'Edited'))
    .with('updated', () => 'Updated')
    .with('moved', () => 'Moved')
    .with('shared', () => 'Shared')
    .with('renamed', () => 'Renamed')
    .with('commented', () => 'Commented')
    .with('deleted', () => (type === 'calendar_event' ? 'Canceled' : 'Deleted'))
    .with('failed', () => 'Failed')
    .exhaustive();
}

/** The tone a receipt's badge takes: losing something is not news to celebrate. */
export function actionTone(action: CardAction): 'accent' | 'neutral' | 'bad' {
  if (action === 'failed') return 'bad';
  if (action === 'deleted') return 'neutral';
  return 'accent';
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

// The app calls a `project` a folder and an `initiative` a project.
const ITEM_KINDS: Record<Exclude<CardItemType, 'document'>, string> = {
  email_thread: 'Email',
  calendar_event: 'Event',
  project: 'Folder',
  channel: 'Channel',
  routine: 'Routine',
  form: 'Form',
  initiative: 'Project',
};

/** What kind of item a card shows, as a reader would name it. */
export function itemKind(type: CardItemType, fileType?: string | null): string {
  return type === 'document' ? documentKind(fileType) : ITEM_KINDS[type];
}
