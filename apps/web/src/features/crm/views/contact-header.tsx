import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { EntityIcon } from '@core/component/EntityIcon';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { isMobile } from '@core/mobile/isMobile';
import { readablePhone } from '@core/util/phone';
import { formatDateAndTime, formatRelativeTimestamp } from '@entity';
import ContactIcon from '@icon/system/regular/address-book.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { Avatar, Badge, badgeTriggerClasses, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { ContactPhonesDialog } from '../components/contact-phones-dialog';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact as CrmContactResponse } from '../core/contact';
import { ContactVisibilityButton } from './contact-visibility-button';
import {
  useCompanyQuery,
  useContactPhonesQuery,
  useSetContactNameMutation,
  useSetContactPhonesMutation,
} from './use-crm';

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

function CompanyPill(props: {
  companyId: string;
  onOpenCompany?: (companyId: string) => boolean;
}) {
  const { openWithSplit } = useCrmContext().createNavigation();
  const { company } = useCompanyQuery(() => props.companyId);
  const openCompany = (event: MouseEvent) => {
    const companyId = props.companyId;
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
 * A number calls through the device's own dialer. On a phone the whole pill
 * dials; on a larger screen the number sits beside a Call link.
 */
function PhonePill(props: { phone: string }) {
  const href = () => `tel:${props.phone}`;
  const number = () => readablePhone(props.phone);
  return (
    <Show
      when={!isMobile()}
      fallback={
        <a
          href={href()}
          aria-label={`Call ${number()}`}
          class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
        >
          <PhoneIcon class="size-3" />
          {number()}
        </a>
      }
    >
      <span class="inline-flex items-center gap-1">
        <Badge variant="outline" size="sm">
          <PhoneIcon class="size-3" />
          {number()}
        </Badge>
        <a
          href={href()}
          aria-label={`Call ${number()}`}
          class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
        >
          Call
        </a>
      </span>
    </Show>
  );
}

/** The contact's numbers, and the button that edits them. */
function ContactPhones(props: { contactId: string }) {
  const phones = useContactPhonesQuery(() => props.contactId);
  const setPhones = useSetContactPhonesMutation();
  const [editing, setEditing] = createSignal(false);
  const numbers = () => (phones.data ?? []).map((phone) => phone.phone);
  return (
    <>
      <For each={numbers()}>{(phone) => <PhonePill phone={phone} />}</For>
      <Show when={phones.isSuccess}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
        >
          <PhoneIcon class="size-3" />
          {numbers().length ? 'Edit phones' : 'Add phone'}
        </button>
      </Show>
      <Show when={editing()}>
        <ContactPhonesDialog
          initial={numbers()}
          onSave={async (next) => {
            await setPhones.mutateAsync({
              contactId: props.contactId,
              phones: next,
            });
          }}
          onClose={() => setEditing(false)}
        />
      </Show>
    </>
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
            <Show when={contact().email}>
              {(email) => (
                <Badge variant="outline" size="sm">
                  <EnvelopeIcon class="size-3" />
                  {email()}
                </Badge>
              )}
            </Show>
            <ContactPhones contactId={contact().id} />
            <Show when={contact().companyId}>
              {(companyId) => (
                <CompanyPill
                  companyId={companyId()}
                  onOpenCompany={props.onOpenCompany}
                />
              )}
            </Show>
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
