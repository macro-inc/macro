import type { EntityData } from '@entity';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import type { SoupState } from '../create-soup-state';

export const makeSenderFilterAction = (
  action: (email: string, linkId?: string) => Promise<void>
) => {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && !!entity.senderEmail;

  const execute = async (entities: EntityData[]) => {
    const seen = new Set<string>();
    for (const entity of entities) {
      if (entity.type !== 'email' || !entity.senderEmail) continue;
      // Filters are per-inbox, so the same sender in two inboxes is two
      // distinct filters — key the dedupe on the inbox too.
      const key = `${entity.linkId ?? ''}:${entity.senderEmail.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await action(entity.senderEmail, toHeaderLinkId(entity.linkId));
    }
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
