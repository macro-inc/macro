import { useItemIdentity } from '@queries/preview';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { type Accessor, createMemo } from 'solid-js';
import type { DocumentEntity } from '../../entity/types/entity';

/** Project eligible document metadata once for every Markdown host. */
export function markdownEntityFromMetadata(
  metadata: DocumentMetadata | undefined,
  name: string | undefined
): DocumentEntity | undefined {
  if (
    !metadata ||
    metadata.fileType !== 'md' ||
    (metadata.subType != null && metadata.subType !== 'snippet')
  )
    return;
  return {
    type: 'document',
    id: metadata.documentId,
    name: name ?? metadata.documentName,
    ownerId: metadata.owner,
    fileType: 'md',
    subType: metadata.subType === 'snippet' ? { type: 'snippet' } : null,
    appearance: metadata.appearance,
  };
}
/** An open document header observes the existing preview projection, not a per-icon fetch. */
export function useDocumentAppearance(
  entity: Accessor<Pick<DocumentEntity, 'id' | 'appearance'> | undefined>,
  authenticated: Accessor<boolean>
) {
  const enabled = createMemo(() => Boolean(entity() && authenticated()));
  const preview = createMemo(() =>
    enabled()
      ? useItemIdentity(() => ({ type: 'document', id: entity()?.id ?? '' }))
      : undefined
  );
  return () => {
    const current = preview()?.();
    return current?.appearance !== undefined
      ? current.appearance
      : entity()?.appearance;
  };
}
