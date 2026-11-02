import { queryReadyGate } from '@queries/gate';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { EntityData } from '../../entity/types/entity';
import { useProjectIdentityQuery } from '../../projects/queries/project-identity';
import { supportsEntityAppearance } from '../core/appearance';

/** Menu-owned access reads, never one permission request per rendered icon. */
export function useAppearanceEditAccess(
  entity: Accessor<EntityData | undefined>,
  userId: Accessor<string | undefined>
) {
  const target = () => {
    const current = entity();
    return current && userId() && supportsEntityAppearance(current)
      ? current
      : undefined;
  };
  const document = useDocumentAccessLevelQuery(() => {
    const current = target();
    return current?.type === 'document' && current.ownerId !== userId()
      ? current.id
      : '';
  });
  const project = useProjectIdentityQuery(() => {
    const current = target();
    return current?.type === 'initiative' && current.ownerId !== userId()
      ? current.id
      : '';
  }, userId);
  return () => {
    const current = target();
    if (!current || !userId()) return false;
    if (current.ownerId === userId()) return true;
    return match(current)
      .with(
        { type: 'document' },
        () =>
          queryReadyGate(document) &&
          (document.data === 'edit' || document.data === 'owner')
      )
      .with(
        { type: 'initiative' },
        () =>
          project.isSuccess &&
          (project.data?.access === 'edit' || project.data?.access === 'owner')
      )
      .with(
        { type: 'database' },
        (entity) => entity.grant === 'edit' || entity.grant === 'owner'
      )
      .with(
        { type: 'form' },
        (entity) => entity.access === 'edit' || entity.access === 'owner'
      )
      .with({ type: 'routine' }, () => false)
      .exhaustive(() => false);
  };
}
