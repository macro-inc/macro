import type { EntityData } from '@entity';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import type { EntityActionListState } from './entity-action-context';

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
      // distinct filters — key the dedupe on the inbox too. Key off the
      // normalized header value so a missing link id and an explicit primary
      // one collapse to a single request.
      const linkId = toHeaderLinkId(entity.linkId);
      const key = `${linkId ?? ''}:${entity.senderEmail.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await action(entity.senderEmail, linkId);
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
