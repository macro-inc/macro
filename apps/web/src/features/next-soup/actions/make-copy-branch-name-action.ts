import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { writeClipboardData } from '@core/util/dataTransfer';
import { type EntityData, isGithubPrEntity, isTaskEntity } from '@entity';
import type { EntityActionListState } from './entity-action-context';

/**
 * Copy the branch to work on: a task's derived branch name, or the branch a
 * pull request was opened from, when it was stored.
 */
export const makeCopyBranchNameAction = (
  options: { silent?: boolean } = {}
) => {
  const canExecute = (entity: EntityData): boolean => {
    if (isGithubPrEntity(entity)) return !!entity.metadata.headBranch;
    return isTaskEntity(entity);
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity) return;
    if (isGithubPrEntity(entity)) {
      const branch = entity.metadata.headBranch;
      if (!branch) return;
      const copied = await writeClipboardData({ 'text/plain': branch });
      if (!copied) {
        toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
        return false;
      }
      if (!options.silent)
        toast.success(t('entityActions.toastBranchNameCopied'));
      return true;
    }
    if (!isTaskEntity(entity)) return;
    return copyBranchNameToClipboard(entity.id, options);
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    return execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
