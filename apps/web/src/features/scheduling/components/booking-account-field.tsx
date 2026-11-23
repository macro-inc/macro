import { createMemo, Show } from 'solid-js';
import {
  type BookingAccount,
  bookingAccountFor,
  PRIMARY_ACCOUNT_LABEL,
} from '../core/booking-account';
import { BookingFieldInfo } from './booking-field-info';
import { SelectInput } from './fields';

/** Which connected account a personal link's bookings land on. */
export function BookingAccountField(props: {
  accounts: BookingAccount[];
  emailLinkId: string | null;
  disabled: boolean;
  error?: string;
  onChange: (emailLinkId: string | null) => void;
}) {
  const account = () =>
    bookingAccountFor({ emailLinkId: props.emailLinkId }, props.accounts);
  const shownAccountId = () =>
    account()?.emailLinkId ?? props.emailLinkId ?? '';
  // Kobalte re-asserts its selection when given a new options array, so the
  // options keep their identity until an account or the named inbox changes.
  const options = createMemo(() => {
    const items = props.accounts.map((item) => ({
      value: item.emailLinkId,
      label: item.emailAddress,
    }));
    if (props.emailLinkId && !account())
      items.push({ value: props.emailLinkId, label: 'Disconnected account' });
    // A link on a primary inbox that lists no bookable calendar still needs
    // an option to show, and choosing it keeps the link on the primary inbox.
    if (!props.emailLinkId && !account())
      items.unshift({ value: '', label: PRIMARY_ACCOUNT_LABEL });
    return items;
  });
  // Only a chosen account is named here: a link left on the primary account
  // keeps the primary inbox's existing behavior, which this note can't describe.
  const staleAccount = () =>
    props.emailLinkId && account()?.needsReconnect ? account() : undefined;
  const choose = (emailLinkId: string) => {
    if (emailLinkId === shownAccountId()) return;
    const chosen = props.accounts.find(
      (item) => item.emailLinkId === emailLinkId
    );
    props.onChange(!emailLinkId || chosen?.primary ? null : emailLinkId);
  };
  return (
    <section class="flex min-w-0 flex-col gap-2">
      <div class="flex items-center gap-1">
        <h4 class="text-sm font-normal tracking-wide text-ink-muted">
          Calendar account
        </h4>
        <BookingFieldInfo
          label="Calendar account"
          description="Bookings are added to this account's calendar, and invitations come from its address. Busy times on all your connected calendars still count."
        />
      </div>
      <SelectInput
        label="Calendar account"
        value={shownAccountId()}
        class="h-9 rounded-lg px-3 text-sm"
        disabled={props.disabled}
        error={props.error}
        options={options()}
        onChange={choose}
      />
      <Show when={staleAccount()}>
        {(stale) => (
          <p class="text-xs text-ink-muted">
            Reconnect {stale().emailAddress} in Settings → Calendar. Until then
            this link offers no times.
          </p>
        )}
      </Show>
    </section>
  );
}
