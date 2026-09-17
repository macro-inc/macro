import type { CalendarEvent } from '@app/features/calendar/types';
import { eventEmailRecipients } from '@app/features/calendar/utils/guest-emails';
import type { CrmCompanyEntity } from '@entity';
import {
  crmCompanyQueryOptions,
  crmCompanyResponseToEntity,
} from '@queries/crm/companies';
import { crmContactByEmailQueryOptions } from '@queries/crm/contacts';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { useCrmEnabled } from './use-crm-enabled';

/**
 * The CRM companies behind an event's guests: each guest but the viewer is
 * resolved to a contact by email, and the distinct companies those contacts
 * belong to are loaded. Empty until the team's CRM is known to be enabled,
 * and while lookups are in flight. A guest without a contact record, or a
 * company the viewer may not see, contributes nothing.
 */
export function useEventCompanies(
  event: Accessor<CalendarEvent>
): Accessor<CrmCompanyEntity[]> {
  const { teamId, crmEnabled } = useCrmEnabled();
  const emails = createMemo(() => eventEmailRecipients(event()));

  const contactQueries = useQueries(() => ({
    queries:
      crmEnabled() && teamId()
        ? emails().map((email) =>
            crmContactByEmailQueryOptions(teamId(), email)
          )
        : [],
  }));
  const companyIds = createMemo(() => {
    const ids = new Set<string>();
    for (const query of contactQueries) {
      if (query.isSuccess && query.data) ids.add(query.data.companyId);
    }
    return [...ids];
  });

  const companyQueries = useQueries(() => ({
    queries: companyIds().map((companyId) => crmCompanyQueryOptions(companyId)),
  }));

  return createMemo(() =>
    companyQueries.flatMap((query) =>
      query.isSuccess && query.data
        ? [crmCompanyResponseToEntity(query.data)]
        : []
    )
  );
}
