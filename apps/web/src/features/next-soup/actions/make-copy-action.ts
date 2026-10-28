import { t } from '@app/lib/i18n';
import { canDuplicateItemType } from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { createBulkCopyDssEntityMutation } from '@entity';
import type { EntityActionListState } from './entity-action-context';

export const makeCopyAction = () => {
  const bulkCopyMutation = createBulkCopyDssEntityMutation();

  // The types the copy mutation duplicates; it rejects any other.
  const canExecute = (entity: EntityData): boolean =>
    (entity.type === 'document' ||
      entity.type === 'chat' ||
      entity.type === 'project') &&
    canDuplicateItemType(entity.type);

  const execute = async (entities: EntityData[]) => {
    try {
      await bulkCopyMutation.mutateAsync({
        entities,
        name: (name) => name,
      });
    } catch {
      toast.failure(
        t('entityActions.toastCopyFailed', { count: entities.length }),
        entities.some((entity) => entity.type === 'project')
          ? { subtext: t('entityActions.folderDuplicateLimitHint') }
          : undefined
      );
      return;
    }
    toast.success(
      entities.length > 1
        ? t('entityActions.toastCopiedCount', { count: entities.length })
        : t('entityActions.toastCopied')
    );
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    await execute(entities);
    soup.selection.clear();
  };

  return { canExecute, execute, executeWithSoup };
};
