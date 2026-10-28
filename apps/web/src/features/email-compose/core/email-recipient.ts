import type { EmailContact } from '../../email-message/core/email-message';
import { getFirstName } from '../../email-message/core/name';

/** Address choices accepted by the composer and shared recipient controls. */
export type EmailRecipient =
  | {
      kind: 'user';
      id: string;
      data: {
        id: string;
        email: string;
        name: string;
        photoUrl?: string;
        lastInteraction?: Date | string;
      };
    }
  | {
      kind: 'contact';
      id: string;
      data: EmailContact & { id: string; type: 'extracted' };
    }
  | {
      kind: 'custom';
      id: string;
      data: { id: string; email: string; invalid: boolean };
    };

export type RecipientFieldId = 'to' | 'cc' | 'bcc';
export type EmailFormRecipients = Record<RecipientFieldId, EmailRecipient[]>;

export function getRecipientDisplayName(item: EmailRecipient): string {
  if (item.kind === 'custom') return item.data.email;
  return getFirstName(item.data.name) || item.data.email;
}
