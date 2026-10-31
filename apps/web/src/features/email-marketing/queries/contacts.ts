import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { contactsClient } from '@service-contacts/client';
import { emailClient } from '@service-email/client';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import type { MarketingCapabilities } from '../context/contracts';
import { type MarketingContact, mergeContacts } from '../core/model';

type CrmContact = Awaited<
  ReturnType<typeof fetchCrmContacts>
>['contacts'][number];

/** Shares Mail's cached inbox list instead of fetching it per call. */
function emailLinksFetchOptions() {
  return {
    queryKey: emailKeys.links.queryKey,
    queryFn: () => throwOnErr(() => emailClient.getLinks()),
    staleTime: 60_000,
  };
}

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
      const { links } = await queryClient.fetchQuery(emailLinksFetchOptions());
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
        throwOnErr(() => contactsClient.getContacts()),
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
        ...personal.contacts.map((id) => ({
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
