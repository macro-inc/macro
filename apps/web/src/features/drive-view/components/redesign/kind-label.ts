import { type TranslationKey, t } from '@app/lib/i18n';
import type { DriveItemKind } from '../../core/drive-items';

const KIND_KEYS: Record<DriveItemKind, TranslationKey> = {
  folder: 'drive.kindFolder',
  markdown: 'drive.kindMarkdown',
  pdf: 'drive.kindPdf',
  image: 'drive.kindImage',
  video: 'drive.kindVideo',
  spreadsheet: 'drive.kindSpreadsheet',
  database: 'drive.kindDatabase',
  form: 'drive.kindForm',
  code: 'drive.kindCode',
  canvas: 'drive.kindCanvas',
  docx: 'drive.kindDocx',
  snippet: 'drive.kindSnippet',
  skill: 'drive.kindSkill',
  email: 'drive.kindEmail',
  chat: 'drive.kindChat',
  file: 'drive.kindFile',
};

export function driveKindLabel(kind: DriveItemKind): string {
  return t(KIND_KEYS[kind]);
}

/** Short uppercase badge text for Grid card visual stages. */
export function driveKindExtensionBadge(
  kind: DriveItemKind,
  fileType?: string
): string {
  if (fileType && fileType.length <= 6 && kind !== 'markdown') {
    return fileType.toUpperCase();
  }
  switch (kind) {
    case 'markdown':
      return 'DOC';
    case 'spreadsheet':
      return 'SHEET';
    case 'database':
      return 'DB';
    case 'form':
      return 'FORM';
    case 'canvas':
      return 'CANVAS';
    case 'snippet':
      return 'SNIPPET';
    case 'skill':
      return 'SKILL';
    case 'chat':
      return 'CHAT';
    case 'email':
      return 'EMAIL';
    default:
      return kind.toUpperCase();
  }
}
