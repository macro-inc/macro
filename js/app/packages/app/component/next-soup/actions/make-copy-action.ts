import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import { createBulkCopyDssEntityMutation } from '@macro-entity';

export const makeCopyAction = () => {
  const bulkCopyMutation = createBulkCopyDssEntityMutation();

  const canExecute = (entity: EntityData): boolean => {
    return entity.type !== 'channel' && entity.type !== 'email';
  };

  const execute = async (entities: EntityData[]) => {
    await bulkCopyMutation.mutateAsync({
      entities,
      name: (name) => name,
    });
    toast.success(
      entities.length > 1 ? `Copied ${entities.length} items` : 'Copied'
    );
  };

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    await execute(entities);
    soup.selection.clear();
  };

  return { canExecute, execute, executeWithSoup };
};
