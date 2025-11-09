import {
  extractDomainFromEmail,
  isConsumerEmail,
} from '@block-contact/util/emailUtils';
import { ENABLE_GMAIL_BASED_CONTACTS } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';

export type CompanyEmailContact = {
  type: 'company';
  id: string;
  name: string;
  domain: string;
  lastInteraction: string;
};

export type PersonEmailContact = {
  type: 'person';
  id: string;
  name: string;
  email: string;
  lastInteraction: string;
};

export type EmailContact = PersonEmailContact | CompanyEmailContact;

export function isPersonEmailContact(
  contact: EmailContact
): contact is PersonEmailContact {
  return contact.type === 'person';
}

export function isCompanyEmailContact(
  contact: EmailContact
): contact is CompanyEmailContact {
  return contact.type === 'company';
}

async function fetchEmailContacts(): Promise<EmailContact[]> {
  if (!ENABLE_GMAIL_BASED_CONTACTS) return [];

  try {
    const response = await emailClient.listContacts();
    if (isErr(response)) return [];

    const [, contactsData] = response;
    if (!contactsData?.contacts) return [];

    const items: EmailContact[] = [];
    const seenCompanies = new Set<string>();

    for (const contactArray of Object.values(contactsData.contacts)) {
      for (const contact of contactArray) {
        if (contact.email_address) {
          items.push({
            type: 'person',
            id: contact.email_address,
            email: contact.email_address,
            name: contact.name || contact.email_address,
            lastInteraction: contact.last_interaction,
          });

          const domain = extractDomainFromEmail(contact.email_address);
          if (
            domain &&
            !seenCompanies.has(domain) &&
            !isConsumerEmail(domain)
          ) {
            seenCompanies.add(domain);
            items.push({
              type: 'company',
              id: domain,
              name: domain,
              domain: domain,
              lastInteraction: contact.last_interaction,
            });
          }
        }
      }
    }

    return items;
  } catch (error) {
    console.error('Failed to fetch contacts:', error);
    return [];
  }
}

const emailContactsResource = createSingletonRoot(() => {
  return createResource(fetchEmailContacts, {
    initialValue: [],
  });
});

export function useEmailContacts() {
  const [resource] = emailContactsResource();
  return createMemo(() => {
    const result = resource.latest;
    return result ?? [];
  });
}
