import { useSplitLayout } from '@components/app/split-layout/layout';
import type { UserCardAction } from '@core/component/userCardActions';
import WideContact from '@icon/system/regular/address-book.svg';
import type { Accessor } from 'solid-js';
import { createCrmContactLookup } from './crm-person';

export function createCrmUserCardAction(
  email: Accessor<string | undefined>
): Accessor<UserCardAction | undefined> {
  const { openWithSplit } = useSplitLayout();
  const crmContact = createCrmContactLookup(email);

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
