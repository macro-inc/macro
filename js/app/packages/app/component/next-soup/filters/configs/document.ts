import { codeFileExtensions } from '@block-code/util/languageSupport';
import { isDocumentEntity, getEntityProjectId } from '@entity';
import { config, IMAGE_EXTENSIONS, isNotTask, NIL } from './base';

export const inFolderFilter = config({
  id: 'in-folder',
  predicate: (e) => !!getEntityProjectId(e),
  query: { exclude: { projectId: [NIL] } },
});

export const docMarkdownFilter = config({
  id: 'doc-markdown',
  predicate: (e) => isDocumentEntity(e) && e.fileType === 'md',
  query: { include: { fileType: ['md'] } },
});

export const docCanvasFilter = config({
  id: 'doc-canvas',
  predicate: (e) => isDocumentEntity(e) && e.fileType === 'canvas',
  query: { include: { fileType: ['canvas'] } },
});

export const DOCUMENT_CONTEXTUAL_FILTERS = [
  inFolderFilter,
  docMarkdownFilter,
  docCanvasFilter,
] as const;

export const fileCodeFilter = config({
  id: 'file-code',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (codeFileExtensions as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileType: codeFileExtensions as unknown as string[] } },
});

export const fileImageFilter = config({
  id: 'file-image',
  predicate: (e) => {
    if (e.type !== 'document') return false;
    return (IMAGE_EXTENSIONS as readonly string[]).includes(e.fileType ?? '');
  },
  query: { include: { fileType: [...IMAGE_EXTENSIONS] } },
});

export const filePdfFilter = config({
  id: 'file-pdf',
  predicate: (e) => e.type === 'document' && e.fileType === 'pdf',
  query: { include: { fileType: ['pdf'] } },
});

export const fileDocxFilter = config({
  id: 'file-docx',
  predicate: (e) => e.type === 'document' && e.fileType === 'docx',
  query: { include: { fileType: ['docx'] } },
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
  query: isNotTask,
});

export const FILE_TYPE_FILTERS = [
  fileCodeFilter,
  fileImageFilter,
  filePdfFilter,
  fileDocxFilter,
  fileOtherFilter,
] as const;
