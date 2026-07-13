import { getInitialsFromName } from '@core/user';
import { AnimatedContactIcon } from '@icon/wide-contact';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { Avatar } from '@ui';
import { Show } from 'solid-js';

export function ContactHeader(props: { contact?: CrmContactResponse }) {
  const displayName = () => props.contact?.name ?? props.contact?.email;
  const showSubtitle = () =>
    props.contact?.name != null && props.contact.name !== props.contact.email;

  // Default avatar mirrors the channel user avatar: initials on a flat circle.
  // Contacts have no photo, so initials come from the name or email.
  const initials = () => {
    const email = props.contact?.email;
    if (!email) return undefined;
    return getInitialsFromName(props.contact?.name, email);
  };

  return (
    <div class="flex items-start gap-3">
      <Avatar size="lg" class="shrink-0">
        <Show
          when={initials()}
          fallback={
            <Avatar.Fallback>
              <AnimatedContactIcon class="size-5 text-ink-muted" />
            </Avatar.Fallback>
          }
          keyed
        >
          {(value) => (
            <Avatar.Fallback class="font-semibold">{value}</Avatar.Fallback>
          )}
        </Show>
      </Avatar>
      <div class="flex min-w-0 flex-col gap-1">
        <h1 class="min-w-0 truncate text-xl font-semibold">
          {displayName() ?? 'Contact'}
        </h1>
        <Show when={showSubtitle()}>
          <p class="truncate text-sm text-ink-muted">{props.contact?.email}</p>
        </Show>
      </div>
    </div>
  );
}
