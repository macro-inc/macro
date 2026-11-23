import { createMemo, Show } from 'solid-js';
import {
  type BookingAccount,
  bookingAccountFor,
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
  // Kobalte re-asserts its selection when given a new options array, so the
  // options keep their identity until an account or the named inbox changes.
  const options = createMemo(() => {
    const items = props.accounts.map((item) => ({
      value: item.emailLinkId,
      label: item.emailAddress,
    }));
    if (props.emailLinkId && !account())
      items.push({ value: props.emailLinkId, label: 'Disconnected account' });
    return items;
  });
  const choose = (emailLinkId: string) => {
    if (emailLinkId === (account()?.emailLinkId ?? props.emailLinkId)) return;
    const chosen = props.accounts.find(
      (item) => item.emailLinkId === emailLinkId
    );
    props.onChange(chosen?.primary ? null : emailLinkId);
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
        value={account()?.emailLinkId ?? props.emailLinkId ?? ''}
        class="h-9 rounded-lg px-3 text-sm"
        disabled={props.disabled}
        error={props.error}
        options={options()}
        onChange={choose}
      />
      <Show when={account()?.needsReconnect && account()}>
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
