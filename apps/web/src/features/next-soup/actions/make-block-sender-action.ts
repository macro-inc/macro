import type { EntityData } from '@entity';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import { blockSenderWithToast } from '@queries/email/thread';
import type { SoupState } from '../create-soup-state';

export const makeBlockSenderAction = () => {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const canExecute = (entity: EntityData): boolean => {
    return entity.type === 'email' && !!entity.senderEmail;
  };

  const execute = async (entities: EntityData[]) => {
    for (const entity of entities) {
      if (entity.type !== 'email' || !entity.senderEmail) continue;
      // The block creates a Gmail filter on one linked account, so it has to
      // target the inbox the thread arrived in.
      await blockSenderWithToast(
        entity.senderEmail,
        toHeaderLinkId(entity.linkId)
      );
    }
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
