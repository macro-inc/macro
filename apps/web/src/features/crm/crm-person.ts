import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import type { CrmCompanyEntity } from '@entity';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import type { Accessor } from 'solid-js';
import {
  useCrmCompanyQuery,
  useCrmContactByEmailQuery,
} from './record-adapter';

/**
 * The current team's CRM contact for an email address, or undefined while it
 * loads, when there is none, or when the team has no CRM. Reads are guarded:
 * an unguarded `data` would suspend whoever renders the person.
 */
export function createCrmContactLookup(
  email: Accessor<string | undefined>
): Accessor<CrmContactResponse | undefined> {
  const crmFlag = useFeatureFlag(enableCrm);
  // Only the contact lookup needs the team, so a workspace without CRM never
  // fetches one.
  const currentTeamQuery = useCurrentTeamQuery(() => crmFlag().enabled);
  const team = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team : undefined;
  const crmEnabled = () => crmFlag().enabled && team()?.crm_enabled === true;
  const contactQuery = useCrmContactByEmailQuery(
    () => team()?.id ?? '',
    () => email() ?? '',
    crmEnabled
  );
  return () =>
    crmEnabled() && contactQuery.isSuccess
      ? (contactQuery.data ?? undefined)
      : undefined;
}

/** A person's CRM contact and the company it belongs to, by email address. */
export function createCrmPerson(email: Accessor<string | undefined>) {
  const contact = createCrmContactLookup(email);
  const { company } = useCrmCompanyQuery(() => contact()?.companyId ?? '');
  return {
    contact,
    company: (): CrmCompanyEntity | undefined =>
      contact() ? company() : undefined,
  };
}
