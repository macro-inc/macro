import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { formatDateAndTime, formatRelativeTimestamp } from '@entity';
import ContactIcon from '@icon/system/regular/address-book.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { Avatar, Badge, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact as CrmContactResponse } from '../core/contact';
import {
  ContactCompanyField,
  ContactEmailField,
  ContactPhonesField,
} from './contact-properties';
import { ContactVisibilityButton } from './contact-visibility-button';
import { useSetContactNameMutation } from './use-crm';

// Renames overwrite `crm_contacts.name`, which is already team-scoped —
// no global directory involved (unlike company renames).
function TitleEditor(props: { contact: CrmContactResponse }) {
  const renameMutation = useSetContactNameMutation();
  return (
    <InlineTitleEditor
      // Nameless contacts display their email; committing it unchanged
      // is a no-op rather than a save.
      value={props.contact.name ?? props.contact.email ?? ''}
      placeholder="Contact"
      ariaLabel="Contact name"
      class="w-full text-2xl"
      onRename={(name) =>
        renameMutation.mutate({
          contactId: props.contact.id,
          companyId: props.contact.companyId,
          name,
        })
      }
    />
  );
}

/**
 * Contact overview header laid out like a project: the name, then the
 * contact's facts as pills beneath it.
 */
export function ContactHeader(props: {
  contact?: CrmContactResponse;
  onOpenCompany?: (companyId: string) => boolean;
}) {
  const { contactInitials: getInitialsFromName } = useCrmContext();
  // Default avatar mirrors the channel user avatar: initials on a flat circle.
  // Contacts have no photo, so initials come from the name or email.
  const initials = () => {
    const contact = props.contact;
    if (!contact?.name && !contact?.email) return undefined;
    return getInitialsFromName(contact.name, contact.email ?? '');
  };

  return (
    <div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Avatar size="lg" class="shrink-0">
          <Show
            when={initials()}
            fallback={
              <Avatar.Fallback>
                <ContactIcon class="size-5 text-ink-muted" />
              </Avatar.Fallback>
            }
            keyed
          >
            {(value) => (
              <Avatar.Fallback class="font-semibold">{value}</Avatar.Fallback>
            )}
          </Show>
        </Avatar>
        <h1 class="min-w-0 max-w-full mobile:flex-1 text-2xl font-semibold">
          <Show
            when={props.contact}
            fallback={<ListSkeleton.Bar class="h-6 w-48" />}
          >
            {(contact) => <TitleEditor contact={contact()} />}
          </Show>
        </h1>
        <Show when={props.contact}>
          {(contact) => (
            <ContactVisibilityButton
              identity
              contactId={contact().id}
              onOpenCompany={props.onOpenCompany}
            />
          )}
        </Show>
      </div>
      <Show when={props.contact}>
        {(contact) => (
          <div
            class="mt-3 flex flex-wrap items-center gap-2"
            aria-label="Contact details"
          >
            <ContactEmailField contact={contact()} />
            <ContactPhonesField contact={contact()} />
            <ContactCompanyField
              contact={contact()}
              onOpenCompany={props.onOpenCompany}
            />
            <Tooltip label={formatDateAndTime(contact().lastInteraction)}>
              <Badge variant="ghost" size="sm">
                <ClockIcon class="size-3" />
                Last interacted{' '}
                {formatRelativeTimestamp(contact().lastInteraction)}
              </Badge>
            </Tooltip>
          </div>
        )}
      </Show>
    </div>
  );
}
