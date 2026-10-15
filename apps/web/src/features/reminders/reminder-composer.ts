import type { EmailEntity } from '@entity';
import { openDialog } from '@ui';
import type { Owner } from 'solid-js';
import { EmailReminderComposer } from './views/email-reminder-composer';

/** Every email entry point shares the same command menu. */
export function openReminderComposer(
  entity: Pick<EmailEntity, 'id' | 'name' | 'type'>,
  options?: { onCreated?: () => void | Promise<void>; owner?: Owner | null }
) {
  openDialog(
    EmailReminderComposer,
    { entity, onCreated: options?.onCreated },
    { owner: options?.owner }
  );
}
