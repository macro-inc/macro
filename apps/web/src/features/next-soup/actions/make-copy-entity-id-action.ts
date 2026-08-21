import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

export const makeCopyEntityIdAction = () => {
  const canExecute = (_entity: EntityData): boolean => {
    return true;
  };

  /** Copying an id needs nothing but the id, so callers that only have one
   *  (e.g. a block, which is keyed by its entity id) can skip resolving the
   *  entity. */
  const executeById = async (id: string) => {
    await navigator.clipboard.writeText(id);
    toast.success('ID copied to clipboard');
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity) return;

    await executeById(entity.id);
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeById, executeWithSoup };
};
