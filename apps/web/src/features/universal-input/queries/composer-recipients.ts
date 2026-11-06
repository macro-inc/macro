import { emailToMacroId } from '@core/user/macroId';
import type { EmailRecipient } from '../../email-compose/core/email-recipient';
import { type Recipient, resolveRecipients } from '../core/recipients';

/** Adapt inferred names to the same recipient chips used by email and events. */
export function composerRecipientOptions(
  people: Recipient[]
): EmailRecipient[] {
  return people.flatMap((person) =>
    person.email
      ? [
          {
            kind: 'user' as const,
            id: person.id,
            data: { id: person.id, name: person.label, email: person.email },
          },
        ]
      : []
  );
}

export function composerRecipients(
  text: string,
  people: Recipient[]
): EmailRecipient[] {
  const { recipients, unresolved } = resolveRecipients(text, people, true);
  return [
    ...recipients.flatMap((recipient): EmailRecipient[] => {
      if (people.some((person) => person.id === recipient.id))
        return composerRecipientOptions([recipient]);
      const email = recipient.email ?? recipient.id;
      const id = emailToMacroId(email) ?? recipient.id;
      return [{ kind: 'custom', id, data: { id, email, invalid: false } }];
    }),
    ...unresolved.map(
      (term): EmailRecipient => ({
        kind: 'custom',
        id: term,
        data: { id: term, email: term, invalid: true },
      })
    ),
  ];
}

export function recipientAddresses(recipients: EmailRecipient[]): string {
  return recipients.map((recipient) => recipient.data.email).join(', ');
}
