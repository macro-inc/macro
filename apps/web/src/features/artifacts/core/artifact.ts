import type { DocumentEntity, EntityData } from '@entity';

/** File types of the HTML documents listed as artifacts. */
export const ARTIFACT_FILE_TYPES = ['html', 'htm'] as const;

/** An artifact is a stored HTML document: the pages agents publish. */
export function isArtifact(entity: EntityData): entity is DocumentEntity {
  if (entity.type !== 'document') return false;

  const fileType = entity.fileType?.toLowerCase();

  return ARTIFACT_FILE_TYPES.some((type) => type === fileType);
}
