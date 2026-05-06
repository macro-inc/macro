import { copyBranchNameToClipboard } from '@core/util/branchName';
import { isTaskEntity, type EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

export const makeCopyBranchNameAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    return isTaskEntity(entity);
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || !isTaskEntity(entity)) return;
    await copyBranchNameToClipboard(entity.id);
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
