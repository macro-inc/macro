import {
  type BlockName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import type { CollabSurfaceParent } from './createCollabSurface';

/**
 * The parent entity type implied by hosting a surface inside a block of the
 * given name. A block's id is the entity id: document-backed blocks (md and
 * friends, incl. task/snippet/skill aliases) are `Document` rows; the rest map
 * to their own entity type.
 *
 * Absent entries (contact, company, automation, pr, unknown) have no
 * backend-supported parent type — a collab surface cannot be hosted in them.
 */
const BLOCK_PARENT_TYPE: Partial<
  Record<BlockName, CollabSurfaceParent['entityType']>
> = {
  md: 'document',
  write: 'document',
  pdf: 'document',
  code: 'document',
  image: 'document',
  canvas: 'document',
  video: 'document',
  channel: 'channel',
  project: 'project',
  chat: 'chat',
  email: 'email_thread',
  call: 'call',
};

/**
 * The collab-surface parent derived from the nearest enclosing block.
 *
 * @throws when used outside a Block component, or inside a block whose type
 * has no parent-entity mapping — a collab surface is always scoped to its
 * hosting block's entity, so both are programming errors.
 */
export function useBlockCollabParent(): CollabSurfaceParent {
  const id = useMaybeBlockId();
  const name = useMaybeBlockName();
  if (!id || !name) {
    throw new Error(
      'CollabMdSurface must be mounted inside a Block component — its parent entity is derived from the enclosing block'
    );
  }
  const entityType = BLOCK_PARENT_TYPE[name];
  if (!entityType) {
    throw new Error(
      `CollabMdSurface cannot be hosted in a '${name}' block: no parent-entity mapping`
    );
  }
  return { entityType, entityId: id };
}
