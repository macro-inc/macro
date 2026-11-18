import type { EntityData } from '@entity';

/** A done email thread returns to the inbox only if it has received mail. */
export const canMarkNotDone = (entity: EntityData): boolean =>
  entity.type === 'email' &&
  entity.done === true &&
  entity.hasReceivedMail !== false;
