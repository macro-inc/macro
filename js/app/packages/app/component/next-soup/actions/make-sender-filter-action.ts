import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

export const makeSenderFilterAction = (
  action: (email: string) => Promise<void>
) => {
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && !!entity.senderEmail;

  const execute = async (entities: EntityData[]) => {
    const seen = new Set<string>();
    for (const entity of entities) {
      if (entity.type !== 'email' || !entity.senderEmail) continue;
      if (seen.has(entity.senderEmail)) continue;
      seen.add(entity.senderEmail);
      await action(entity.senderEmail);
    }
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
