import type { FilterID } from '@app/component/next-soup/filters';
import type {
  DocumentFilterExpression,
  Query,
} from '@app/component/next-soup/filters/filter-store';

const DOCUMENT_TYPE_FILTER_IDS = [
  'doc-markdown',
  'doc-canvas',
  'file-code',
  'file-image',
  'file-pdf',
  'file-docx',
  'file-video',
  'doc-snippet',
  'file-other',
] as const satisfies readonly FilterID[];

type DocumentTypeFilterId = (typeof DOCUMENT_TYPE_FILTER_IDS)[number];

export const documentTypeFilterIds = new Set<string>(DOCUMENT_TYPE_FILTER_IDS);

export const isDocumentTypeFilterId = (
  id: string
): id is DocumentTypeFilterId => documentTypeFilterIds.has(id);

const documentTypeExpressions: Record<
  DocumentTypeFilterId,
  DocumentFilterExpression
> = {
  'doc-markdown': {
    op: 'and',
    clauses: [
      { include: { fileType: ['md'] } },
      { exclude: { subType: ['snippet', 'task'] } },
    ],
  },
  'doc-canvas': { include: { fileType: ['canvas'] } },
  'file-code': { include: { fileAssoc: ['assoc:code'] } },
  'file-image': { include: { fileAssoc: ['assoc:image'] } },
  'file-pdf': { include: { fileType: ['pdf'] } },
  'file-docx': { include: { fileType: ['docx'] } },
  'file-video': { include: { fileAssoc: ['assoc:video'] } },
  'doc-snippet': {
    op: 'and',
    clauses: [
      { include: { fileType: ['md'] } },
      { include: { subType: ['snippet'] } },
    ],
  },
  'file-other': {
    include: { fileAssoc: ['assoc:other'] },
    exclude: { fileAssoc: ['assoc:document', 'assoc:image', 'assoc:video'] },
  },
};

export const getActiveDocumentTypeFilterIds = (
  isActive: (id: string) => boolean
) => DOCUMENT_TYPE_FILTER_IDS.filter((id) => isActive(id));

export const buildDocumentTypeQuery = (
  ids: readonly string[]
): Query | undefined => {
  const clauses = ids
    .filter(isDocumentTypeFilterId)
    .map((id) => documentTypeExpressions[id]);

  if (clauses.length === 0) return undefined;

  return {
    documentWhere: clauses.length === 1 ? clauses[0] : { op: 'or', clauses },
  };
};
