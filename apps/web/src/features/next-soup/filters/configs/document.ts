import { codeFileExtensions } from '@block-code/util/languageSupport';
import { isDocumentEntity } from '@entity';
import {
  config,
  IMAGE_EXTENSIONS,
  isEmailAttachment,
  VIDEO_EXTENSIONS,
} from './base';

const docMarkdownFilter = config({
  id: 'doc-markdown',
  predicate: (e) => isDocumentEntity(e) && e.fileType === 'md' && !e.subType,
  query: { include: { fileAssoc: ['assoc:md'] } },
});

const docSnippetFilter = config({
  id: 'doc-snippet',
  predicate: (e) => isDocumentEntity(e) && e.subType?.type === 'snippet',
  // Snippets are markdown documents in storage; subtype is enforced client-side
  // so this composes with other file-type OR filters.
  query: { include: { fileAssoc: ['assoc:md'] } },
});

const docCanvasFilter = config({
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
  docSnippetFilter,
  docCanvasFilter,
  emailAttachmentsFilter,
] as const;

const fileCodeFilter = config({
  id: 'file-code',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (codeFileExtensions as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileAssoc: ['assoc:code'] } },
});

const fileImageFilter = config({
  id: 'file-image',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (IMAGE_EXTENSIONS as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileAssoc: ['assoc:image'] } },
});

const filePdfFilter = config({
  id: 'file-pdf',
  predicate: (e) => e.type === 'document' && e.fileType === 'pdf',
  query: { include: { fileAssoc: ['assoc:pdf'] } },
});

const fileDocxFilter = config({
  id: 'file-docx',
  predicate: (e) => e.type === 'document' && e.fileType === 'docx',
  query: { include: { fileAssoc: ['assoc:document'] } },
});

const fileVideoFilter = config({
  id: 'file-video',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (VIDEO_EXTENSIONS as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileAssoc: ['assoc:video'] } },
});

const fileOtherFilter = config({
  id: 'file-other',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    const ft = e.fileType ?? '';
    if (['md', 'canvas', 'pdf', 'docx'].includes(ft)) return false;
    if ((codeFileExtensions as readonly string[]).includes(ft)) return false;
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(ft)) return false;
    if ((VIDEO_EXTENSIONS as readonly string[]).includes(ft)) return false;
    return true;
  },
  query: {
    include: { fileAssoc: ['assoc:other'] },
    exclude: { fileAssoc: ['assoc:document', 'assoc:image', 'assoc:video'] },
  },
});

export const FILE_TYPE_FILTERS = [
  fileCodeFilter,
  fileImageFilter,
  filePdfFilter,
  fileDocxFilter,
  fileVideoFilter,
  fileOtherFilter,
] as const;
