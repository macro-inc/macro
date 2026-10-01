import { EntityIcon } from '@core/component/EntityIcon';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { formatDateAndTime, formatRelativeTimestamp } from '@entity';
import ContactIcon from '@phosphor/address-book.svg';
import ClockIcon from '@phosphor/clock.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import { Avatar, Badge, badgeTriggerClasses, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact as CrmContactResponse } from '../core/contact';
import { useCompanyQuery, useSetContactNameMutation } from './use-crm';

// Renames overwrite `crm_contacts.name`, which is already team-scoped —
// no global directory involved (unlike company renames).
function TitleEditor(props: { contact: CrmContactResponse }) {
  const renameMutation = useSetContactNameMutation();
  return (
    <InlineTitleEditor
      // Nameless contacts display their email; committing it unchanged
      // is a no-op rather than a save.
      value={props.contact.name ?? props.contact.email}
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

function CompanyPill(props: {
  contact: CrmContactResponse;
  onOpenCompany?: (companyId: string) => boolean;
}) {
  const { openWithSplit } = useCrmContext().createNavigation();
  const { company } = useCompanyQuery(() => props.contact.companyId);
  const openCompany = (event: MouseEvent) => {
    const companyId = props.contact.companyId;
    if (!event.shiftKey && props.onOpenCompany?.(companyId)) return;
    openWithSplit(
      { type: 'company', id: companyId },
      { activate: true, preferNewSplit: event.shiftKey }
    );
  };
  return (
    <button
      type="button"
      onClick={openCompany}
      class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
    >
      <EntityIcon targetType="crm_company" size="xs" />
      {company()?.name ?? 'Open company'}
    </button>
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
    const email = props.contact?.email;
    if (!email) return undefined;
    return getInitialsFromName(props.contact?.name, email);
  };

  return (
    <div>
      <div class="flex items-center gap-3">
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
        <h1 class="min-w-0 flex-1 text-2xl font-semibold">
          <Show when={props.contact} fallback={'Loading contact…'}>
            {(contact) => <TitleEditor contact={contact()} />}
          </Show>
        </h1>
      </div>
      <Show when={props.contact}>
        {(contact) => (
          <div
            class="mb-6 mt-3 flex flex-wrap items-center gap-2"
            aria-label="Contact details"
          >
            <Badge variant="outline" size="sm">
              <EnvelopeIcon class="size-3" />
              {contact().email}
            </Badge>
            <CompanyPill
              contact={contact()}
              onOpenCompany={props.onOpenCompany}
            />
            <Tooltip label={formatDateAndTime(contact().lastInteraction)}>
              <Badge variant="outline" size="sm">
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
