import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { type Accessor, createMemo } from 'solid-js';
import type { DocumentEntity } from '../../entity/types/entity';

/** An open document header observes the existing preview projection, not a per-icon fetch. */
export function useDocumentAppearance(
  entity: Accessor<DocumentEntity | undefined>,
  authenticated: Accessor<boolean>
) {
  const enabled = createMemo(() => Boolean(entity() && authenticated()));
  const preview = createMemo(() =>
    enabled()
      ? useItemPreview(() => ({ type: 'document', id: entity()?.id ?? '' }))[0]
      : undefined
  );
  return () => {
    const current = preview()?.();
    return current && isAccessiblePreviewItem(current)
      ? current.appearance
      : entity()?.appearance;
  };
}
