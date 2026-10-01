import { useCrmContactByEmailQuery } from '@app/features/crm/record-adapter';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { UserCardAction } from '@core/component/userCardActions';
import { enableCrm } from '@core/constant/featureFlags';
import WideContact from '@phosphor/address-book.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Accessor } from 'solid-js';

export function createCrmUserCardAction(
  email: Accessor<string | undefined>
): Accessor<UserCardAction | undefined> {
  const crmFlag = useFeatureFlag(enableCrm);
  const { openWithSplit } = useSplitLayout();
  // Only the CRM contact lookup needs the team, so a card on a workspace
  // without CRM never fetches one.
  const currentTeamQuery = useCurrentTeamQuery(() => crmFlag().enabled);
  // Guarded reads: an unguarded `data` suspends whoever renders the card, and
  // a card that suspends takes its hover surface or sheet down with it.
  const team = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team : undefined;
  const crmEnabled = () => crmFlag().enabled && team()?.crm_enabled === true;
  const contactQuery = useCrmContactByEmailQuery(
    () => team()?.id ?? '',
    () => email() ?? '',
    crmEnabled
  );
  const crmContact = () =>
    crmEnabled() && contactQuery.isSuccess ? contactQuery.data : undefined;

  const openContact = (event: MouseEvent, contactId: string) => {
    event.preventDefault();
    event.stopPropagation();
    openWithSplit(
      { type: 'contact', id: contactId },
      { preferNewSplit: event.shiftKey, reopen: 'latest' }
    );
  };

  return () => {
    const contact = crmContact();
    return contact
      ? {
          id: 'open-contact',
          label: 'Open contact',
          icon: WideContact,
          onSelect: (event) => openContact(event, contact.id),
        }
      : undefined;
  };
}
