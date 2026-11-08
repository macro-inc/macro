import { t } from '@app/lib/i18n';
import { createRenameDssEntityMutation, type EntityData } from '@entity';
import {
  createInlineRename,
  type InlineRename,
} from '@ui/components/InlineRename';
import { ResultAsync } from 'neverthrow';
import { getOwner, runWithOwner } from 'solid-js';

/**
 * The rename behind a split panel's list rows: one row at a time, started by
 * the row's Rename action and drawn by its `Entity.Title`. The mutation is
 * made on the first rename, under the split's owner, so a split that never
 * renames a row needs no query client.
 */
export function createSplitRowRename(): InlineRename<EntityData> {
  const owner = getOwner();
  let mutation: ReturnType<typeof createRenameDssEntityMutation> | undefined;
  const renameMutation = () => {
    mutation ??= runWithOwner(owner, createRenameDssEntityMutation);
    if (!mutation) throw new Error('A split row rename needs its owner');
    return mutation;
  };
  return createInlineRename({
    key: (entity: EntityData) => `${entity.type}:${entity.id}`,
    name: (entity) => entity.name,
    rename: (entity, newName) =>
      ResultAsync.fromPromise(
        renameMutation().mutateAsync({ entity, newName }),
        () => undefined
      ),
    failureMessage: () => t('entityActions.toastRenameFailed'),
  });
}
