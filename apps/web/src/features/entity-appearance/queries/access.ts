import { queryReadyGate } from '@queries/gate';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import type { Accessor } from 'solid-js';
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
    if (current.type === 'document') {
      return (
        queryReadyGate(document) &&
        (document.data === 'edit' || document.data === 'owner')
      );
    }
    if (current.type === 'initiative') {
      return (
        project.isSuccess &&
        (project.data?.access === 'edit' || project.data?.access === 'owner')
      );
    }
    if (current.type === 'database')
      return current.grant === 'edit' || current.grant === 'owner';
    if (current.type === 'form')
      return current.access === 'edit' || current.access === 'owner';
    return false;
  };
}
