import { isSpamEmail } from '@app/features/next-soup/filters/inbox-filters';
import type { EntityData } from '@entity';
import { markThreadNotSpamWithToast } from '@queries/email/thread';
import type { EntityActionListState } from './entity-action-context';

/**
 * "Not Spam": moves a thread the provider filed as spam back into the inbox.
 * Spam threads surface in the Noise view so a misclassified message (a
 * confirmation email, say) can be fished out; this is the fishing.
 */
export const makeMarkNotSpamAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && isSpamEmail(entity);

  const execute = async (entities: EntityData[]) => {
    for (const entity of entities) {
      if (entity.type !== 'email' || !isSpamEmail(entity)) continue;
      // Labels are per inbox, so the lookup needs the thread's own inbox.
      await markThreadNotSpamWithToast(entity.id, entity.linkId);
    }
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
