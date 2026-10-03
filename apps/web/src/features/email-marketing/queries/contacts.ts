import { throwOnErr } from '@core/util/result';
import { contactsClient } from '@service-contacts/client';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { MarketingCapabilities } from '../context/contracts';
import { type MarketingContact, mergeContacts } from '../core/model';

function toCrmContact(contact: {
  email: string;
  name?: string | null;
  id: string;
  companyId: string;
}): MarketingContact {
  return {
    email: contact.email,
    name: contact.name ?? '',
    crmContactId: contact.id,
    companyId: contact.companyId,
  };
}

export function createContactQueries(
  userId: () => string | undefined
): Pick<
  MarketingCapabilities,
  'loadSenders' | 'loadContacts' | 'searchCrmContacts'
> {
  return {
    async loadSenders() {
      const { links } = await throwOnErr(() => emailClient.getLinks());
      return links
        .filter(
          (link) => link.provider === 'GMAIL' && link.macro_id === userId()
        )
        .map((link) => ({
          id: link.id,
          email: link.email_address,
          ready: !link.needs_reauth,
        }));
    },
    async loadContacts() {
      const [personal, gmail, crm] = await Promise.all([
        contactsClient.getContacts(),
        emailClient.listContacts(),
        storageServiceClient.searchContacts({ limit: 500 }),
      ]);
      if (personal.isErr())
        throw new Error(
          personal.error.map((error) => error.message).join('; ')
        );
      if (
        gmail.isErr() &&
        !gmail.error.every((error) =>
          ['NOT_FOUND', 'NO_GMAIL_GRANT'].includes(error.code)
        )
      )
        throw new Error(gmail.error.map((error) => error.message).join('; '));
      // CRM is optional for this module. Authorization failures are not bypassed.
      if (
        crm.isErr() &&
        !crm.error.every((error) =>
          ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)
        )
      )
        throw new Error(crm.error.map((error) => error.message).join('; '));
      return mergeContacts([
        ...personal.value.contacts.map((id) => ({
          email: id.replace(/^macro\|/, ''),
          name: '',
        })),
        ...(gmail.isOk()
          ? Object.values(gmail.value.contacts)
              .flat()
              .map((contact) => ({
                email: contact.email_address || contact.email,
                name: contact.name ?? '',
              }))
          : []),
        ...(crm.isOk()
          ? crm.value.contacts
              .filter((contact) => !contact.hidden)
              .map(toCrmContact)
          : []),
      ]);
    },
    async searchCrmContacts(query) {
      const { contacts } = await throwOnErr(() =>
        storageServiceClient.searchContacts({ query, limit: 500 })
      );
      return contacts.filter((contact) => !contact.hidden).map(toCrmContact);
    },
  };
}
