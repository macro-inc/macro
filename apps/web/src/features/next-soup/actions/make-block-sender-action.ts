import { isViewerAddress } from '@app/features/email-message/core/email-user';
import { useEmail } from '@core/context/user';
import type { EntityData } from '@entity';
import {
  useEmailLinksQuery,
  useNonPrimaryEmailLinkIdHeader,
} from '@queries/email/link';
import { blockSenderWithToast } from '@queries/email/thread';
import { queryReadyGate } from '@queries/gate';
import type { EntityActionListState } from './entity-action-context';

export const makeBlockSenderAction = () => {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const links = useEmailLinksQuery();
  const loginEmail = useEmail();

  // A row's sender can be the viewer (Sent, or a thread they started). Like
  // an open thread, no sender counts as blockable until the viewer's inbox
  // addresses load, so Shift+B never blocks the viewer's own address.
  const isViewer = (address: string): boolean => {
    if (!queryReadyGate(links)) return true;
    return [
      loginEmail(),
      ...links.data.links.map((link) => link.email_address),
    ].some((email) => isViewerAddress(address, email));
  };

  const canExecute = (entity: EntityData): boolean => {
    return (
      entity.type === 'email' &&
      !!entity.senderEmail &&
      !isViewer(entity.senderEmail)
    );
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

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
