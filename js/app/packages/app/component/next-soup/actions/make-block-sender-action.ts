import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import { blockSenderWithToast } from '@queries/email/thread';

export const makeBlockSenderAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    return entity.type === 'email' && !!entity.senderEmail;
  };

  const execute = async (entities: EntityData[]) => {
    for (const entity of entities) {
      if (entity.type !== 'email' || !entity.senderEmail) continue;
      await blockSenderWithToast(entity.senderEmail);
    }
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
