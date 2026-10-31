import { macroIdToEmail, tryMacroId } from '@core/user/macroId';
import { ThrownResultError } from '@core/util/result';
import { queryClient } from '@queries/client';
import { contactsQueryOptions } from '@queries/contacts/contacts';
import { emailLinksQueryOptions } from '@queries/email/link';
import { emailClient } from '@service-email/client';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import type { MarketingCapabilities } from '../context/contracts';
import { type MarketingContact, mergeContacts } from '../core/model';

type CrmContact = Awaited<
  ReturnType<typeof fetchCrmContacts>
>['contacts'][number];

/** Inboxes connected in another tab show up within a minute. */
const SENDERS_STALE_TIME = 60_000;

/** CRM contacts are optional; GraphQL already excludes hidden ones. */
const CRM_CONTACT_LIMIT = 500;
const CRM_SEARCH_LIMIT = 100;

function toCrmContact(contact: CrmContact): MarketingContact {
  return {
    email: contact.email,
    name: contact.crmContactName ?? '',
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
      // Shares Mail's cached inbox list instead of fetching it per call.
      const { links } = await queryClient.fetchQuery({
        ...emailLinksQueryOptions(),
        staleTime: SENDERS_STALE_TIME,
      });
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
      // The GraphQL source spans every CRM team the viewer can see.
      const [personal, gmail, crm] = await Promise.all([
        queryClient.fetchQuery(contactsQueryOptions()),
        emailClient.listContacts(),
        fetchCrmContacts({ limit: CRM_CONTACT_LIMIT }),
      ]);
      // An account without Gmail just has no Gmail contacts.
      if (
        gmail.isErr() &&
        !gmail.error.every((error) =>
          ['NOT_FOUND', 'NO_GMAIL_GRANT'].includes(error.code)
        )
      )
        throw new ThrownResultError(gmail.error);
      return mergeContacts([
        ...personal.contacts.flatMap((id) => {
          const macroId = tryMacroId(id);
          return macroId ? [{ email: macroIdToEmail(macroId), name: '' }] : [];
        }),
        ...(gmail.isOk()
          ? Object.values(gmail.value.contacts)
              .flat()
              .map((contact) => ({
                email: contact.email_address || contact.email,
                name: contact.name ?? '',
              }))
          : []),
        ...crm.contacts.map(toCrmContact),
      ]);
    },
    async searchCrmContacts(query) {
      const { contacts } = await fetchCrmContacts({
        search: query,
        limit: CRM_SEARCH_LIMIT,
      });
      return contacts.map(toCrmContact);
    },
  };
}
