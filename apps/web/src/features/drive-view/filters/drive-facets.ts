import {
  clause,
  type Facet,
  type FacetClause,
  type FacetOption,
  TAG_FACET_ID,
  type TagFacetContext,
  tagFacetOption,
} from '@app/features/soup/filters';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import type { EntityData, EntityWithProperties } from '@entity';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] as const;
const VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'webm',
  'avi',
  'mov',
  'wmv',
  'mpg',
  'mpeg',
  'm4v',
  'flv',
  'f4v',
  'threegp',
] as const;

export type DriveFacetContext = TagFacetContext;
export type DriveFacetEntity = EntityWithProperties<EntityData>;

type DriveFacetOption = FacetOption<DriveFacetEntity, DriveFacetContext>;

type DocumentTypeOptionId =
  | 'doc-markdown'
  | 'doc-canvas'
  | 'doc-spreadsheet'
  | 'file-code'
  | 'file-image'
  | 'file-pdf'
  | 'file-docx'
  | 'file-video'
  | 'doc-snippet'
  | 'doc-skill'
  | 'file-other';

function typeOption(
  id: DocumentTypeOptionId,
  expression: FacetClause['df'],
  predicate: (entity: DriveFacetEntity) => boolean
): DriveFacetOption {
  return { id, clause: { df: expression }, predicate };
}

const namedDocumentSubtype = clause.or(
  clause.eq('subType', 'task'),
  clause.eq('subType', 'snippet'),
  clause.eq('subType', 'skill')
);

const TYPE_OPTIONS: DriveFacetOption[] = [
  typeOption(
    'doc-markdown',
    clause.and(clause.eq('fileType', 'md'), clause.not(namedDocumentSubtype)),
    (entity) =>
      entity.type === 'document' && entity.fileType === 'md' && !entity.subType
  ),
  typeOption(
    'doc-canvas',
    clause.eq('fileType', 'canvas'),
    (entity) => entity.type === 'document' && entity.fileType === 'canvas'
  ),
  typeOption(
    'doc-spreadsheet',
    clause.eq('fileType', 'spreadsheet'),
    (entity) => entity.type === 'document' && entity.fileType === 'spreadsheet'
  ),
  typeOption(
    'file-code',
    clause.eq('fileAssoc', 'assoc:code'),
    (entity) =>
      entity.type === 'document' &&
      (codeFileExtensions as readonly string[]).includes(entity.fileType ?? '')
  ),
  typeOption(
    'file-image',
    clause.eq('fileAssoc', 'assoc:image'),
    (entity) =>
      entity.type === 'document' &&
      (IMAGE_EXTENSIONS as readonly string[]).includes(entity.fileType ?? '')
  ),
  typeOption(
    'file-pdf',
    clause.eq('fileType', 'pdf'),
    (entity) => entity.type === 'document' && entity.fileType === 'pdf'
  ),
  typeOption(
    'file-docx',
    clause.eq('fileType', 'docx'),
    (entity) => entity.type === 'document' && entity.fileType === 'docx'
  ),
  typeOption(
    'file-video',
    clause.eq('fileAssoc', 'assoc:video'),
    (entity) =>
      entity.type === 'document' &&
      (VIDEO_EXTENSIONS as readonly string[]).includes(entity.fileType ?? '')
  ),
  typeOption(
    'doc-snippet',
    clause.and(clause.eq('fileType', 'md'), clause.eq('subType', 'snippet')),
    (entity) => entity.type === 'document' && entity.subType?.type === 'snippet'
  ),
  typeOption(
    'doc-skill',
    clause.and(clause.eq('fileType', 'md'), clause.eq('subType', 'skill')),
    (entity) => entity.type === 'document' && entity.subType?.type === 'skill'
  ),
  typeOption(
    'file-other',
    clause.and(
      clause.eq('fileAssoc', 'assoc:other'),
      clause.not(
        clause.or(
          clause.eq('fileAssoc', 'assoc:document'),
          clause.eq('fileAssoc', 'assoc:image'),
          clause.eq('fileAssoc', 'assoc:video')
        )
      )
    ),
    (entity) => {
      if (entity.type !== 'document') return false;

      const fileType = entity.fileType ?? '';

      if (['md', 'canvas', 'spreadsheet', 'pdf', 'docx'].includes(fileType)) {
        return false;
      }
      if ((codeFileExtensions as readonly string[]).includes(fileType)) {
        return false;
      }
      if ((IMAGE_EXTENSIONS as readonly string[]).includes(fileType)) {
        return false;
      }
      if ((VIDEO_EXTENSIONS as readonly string[]).includes(fileType)) {
        return false;
      }

      return true;
    }
  ),
];

const SEARCH_FILE_TYPES: Record<string, readonly string[] | undefined> = {
  'doc-markdown': ['md'],
  'doc-canvas': ['canvas'],
  'doc-spreadsheet': ['spreadsheet'],
  'doc-snippet': ['md'],
  'doc-skill': ['md'],
  'file-code': codeFileExtensions,
  'file-image': IMAGE_EXTENSIONS,
  'file-pdf': ['pdf'],
  'file-docx': ['docx'],
  'file-video': VIDEO_EXTENSIONS,
};

/** A safe service-search superset; subtype exclusions still run client-side. */
export function driveSearchFileTypes(
  ids: readonly string[]
): string[] | undefined {
  if (ids.includes('file-other')) return undefined;

  const fileTypes = ids.flatMap((id) => SEARCH_FILE_TYPES[id] ?? []);

  if (fileTypes.length === 0) return undefined;

  return [...new Set(fileTypes)];
}

function creatorOption(id: string): DriveFacetOption {
  return {
    id,
    clause: {
      df: clause.eq('documentOwnerId', id),
      cf: clause.eq('chatOwnerId', id),
      pf: clause.eq('folderOwnerId', id),
    },
    predicate: (entity) => entity.ownerId === id,
  };
}

export const DRIVE_FACETS: Facet<
  DriveFacetEntity,
  DriveFacetContext,
  DriveFacetOption
>[] = [
  {
    id: 'type',
    mode: 'or',
    restrict: true,
    options: TYPE_OPTIONS,
  },
  { id: 'created-by', mode: 'or', options: creatorOption },
  {
    id: TAG_FACET_ID,
    mode: 'or',
    options: (optionId, context) =>
      tagFacetOption<DriveFacetEntity>(optionId, context),
  },
];
