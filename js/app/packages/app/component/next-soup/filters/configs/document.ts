import { codeFileExtensions } from '@block-code/util/languageSupport';
import { isDocumentEntity } from '@entity';
import { config, IMAGE_EXTENSIONS, isEmailAttachment } from './base';

export const docMarkdownFilter = config({
  id: 'doc-markdown',
  predicate: (e) => isDocumentEntity(e) && e.fileType === 'md',
  query: { include: { fileAssoc: ['assoc:md'] } },
});

export const docCanvasFilter = config({
  id: 'doc-canvas',
  predicate: (e) => isDocumentEntity(e) && e.fileType === 'canvas',
  query: { include: { fileAssoc: ['assoc:canvas'] } },
});

/**
 * Email attachments filter - filters for documents that are email attachments.
 * Server-side only: `isEmailAttachment` is not available on client entity.
 */
export const emailAttachmentsFilter = config({
  id: 'email-attachments',
  predicate: (e) => e.type === 'document', // Server handles actual filtering via `iea`
  query: isEmailAttachment,
});

export const DOCUMENT_CONTEXTUAL_FILTERS = [
  docMarkdownFilter,
  docCanvasFilter,
  emailAttachmentsFilter,
] as const;

export const fileCodeFilter = config({
  id: 'file-code',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (codeFileExtensions as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileAssoc: ['assoc:code'] } },
});

export const fileImageFilter = config({
  id: 'file-image',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (IMAGE_EXTENSIONS as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileAssoc: ['assoc:image'] } },
});

export const filePdfFilter = config({
  id: 'file-pdf',
  predicate: (e) => e.type === 'document' && e.fileType === 'pdf',
  query: { include: { fileAssoc: ['assoc:pdf'] } },
});

export const fileDocxFilter = config({
  id: 'file-docx',
  predicate: (e) => e.type === 'document' && e.fileType === 'docx',
  query: { include: { fileAssoc: ['assoc:document'] } },
});

export const fileOtherFilter = config({
  id: 'file-other',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    const ft = e.fileType ?? '';
    if (['md', 'canvas', 'pdf', 'docx'].includes(ft)) return false;
    if ((codeFileExtensions as readonly string[]).includes(ft)) return false;
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(ft)) return false;
    return true;
  },
  query: {
    include: { fileAssoc: ['assoc:other'] },
    exclude: { fileAssoc: ['assoc:document', 'assoc:image'] },
  },
});

export const FILE_TYPE_FILTERS = [
  fileCodeFilter,
  fileImageFilter,
  filePdfFilter,
  fileDocxFilter,
  fileOtherFilter,
] as const;
