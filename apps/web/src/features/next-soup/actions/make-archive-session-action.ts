import { changeSessionArchiveState } from '@app/features/block-agent/queries/change-session-archive-state';
import type { EntityData } from '@entity';

type MakeArchiveSessionOptions = {
  userId: () => string | undefined;
};

/** Archive or unarchive an agent session; only its owner may. */
export const makeArchiveSessionAction = (
  options: MakeArchiveSessionOptions
) => {
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'agent_session' && entity.ownerId === options.userId();

  const isArchived = (entity: EntityData): boolean =>
    entity.type === 'agent_session' && entity.isArchived === true;

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity || !canExecute(entity)) return;
    await changeSessionArchiveState(entity.id, !isArchived(entity));
  };

  return { canExecute, isArchived, execute };
};
