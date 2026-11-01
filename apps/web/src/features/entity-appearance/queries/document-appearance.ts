import { useItemIdentity } from '@queries/preview';
import { type Accessor, createMemo } from 'solid-js';
import type { DocumentEntity } from '../../entity/types/entity';

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
