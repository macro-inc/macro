import { copyBranchNameToClipboard } from '@core/util/branchName';
import { type EntityData, isTaskEntity } from '@entity';
import type { EntityActionListState } from './entity-action-context';

export const makeCopyBranchNameAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    return isTaskEntity(entity);
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || !isTaskEntity(entity)) return;
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
