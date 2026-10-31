import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { type EntityData, isGithubPrEntity, isTaskEntity } from '@entity';
import type { EntityActionListState } from './entity-action-context';

/**
 * Copy the branch to work on: a task's derived branch name, or the branch a
 * pull request was opened from, when it was stored.
 */
export const makeCopyBranchNameAction = () => {
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
      await navigator.clipboard.writeText(branch);
      toast.success(t('entityActions.toastBranchNameCopied'));
      return;
    }
    if (!isTaskEntity(entity)) return;
    await copyBranchNameToClipboard(entity.id);
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
