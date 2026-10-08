import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { createBulkCopyDssEntityMutation } from '@entity';
import type { EntityActionListState } from './entity-action-context';

export const makeCopyAction = () => {
  const bulkCopyMutation = createBulkCopyDssEntityMutation();

  const canExecute = (entity: EntityData): boolean => {
    return (
      entity.type !== 'database' &&
      entity.type !== 'form' &&
      entity.type !== 'agent_session' &&
      entity.type !== 'channel' &&
      entity.type !== 'email' &&
      entity.type !== 'channel_message' &&
      entity.type !== 'channel_thread' &&
      entity.type !== 'foreign' &&
      entity.type !== 'routine'
    );
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

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    await execute(entities);
    soup.selection.clear();
  };

  return { canExecute, execute, executeWithSoup };
};
