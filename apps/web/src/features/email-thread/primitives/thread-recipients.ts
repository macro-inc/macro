import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { EmailRecipient } from '../../email-compose/core/email-recipient';
import { convertContactInfoToEmailRecipient } from '../../email-compose/core/recipient-conversion';
import type {
  EmailContact,
  EmailMessage,
} from '../../email-message/core/email-message';

/** Merge address-book, thread and locally added recipients in their existing order. */
export function createThreadRecipients(
  contacts: Accessor<EmailRecipient[]>,
  messages: Accessor<EmailMessage[] | undefined>
) {
  const [augmentedRecipients, setAugmentedRecipients] = createSignal<
    EmailRecipient[]
  >([]);

  function onRecipientsChange(items: EmailRecipient[]) {
    const existing = augmentedRecipients();
    const existingEmails = new Set(
      existing.map((r) => r.data.email).filter((e) => e.length > 0)
    );

    const uniques: EmailRecipient[] = [];
    for (const r of items) {
      const email = r.data.email;
      if (email && !existingEmails.has(email)) {
        existingEmails.add(email);
        uniques.push(r);
      }
    }

    if (uniques.length === 0) return;
    setAugmentedRecipients([...existing, ...uniques]);
  }

  const getRecipientOptions = () => {
    const optionsMap = new Map<string, EmailRecipient>();

    for (const contact of contacts()) {
      optionsMap.set(contact.data.email, contact);
    }

    const threadMessages = messages();
    if (threadMessages) {
      const seen = new Map<string, EmailContact>();

      const add = (c: EmailContact) => {
        const existing = seen.get(c.email);
        if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
      };

      threadMessages.forEach((m) => {
        m.to.forEach(add);
        m.cc.forEach(add);
        m.bcc.forEach(add);
        if (m.from?.email)
          add({
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
      });

      for (const value of seen.values()) {
        const mapped = convertContactInfoToEmailRecipient(value);
        optionsMap.set(mapped.data.email, mapped);
      }
    }

    augmentedRecipients().forEach((r) => {
      const email = r.data.email;
      if (email && !optionsMap.has(email)) optionsMap.set(email, r);
    });

    return Array.from(optionsMap.values());
  };

  return { options: createMemo(getRecipientOptions), add: onRecipientsChange };
}
