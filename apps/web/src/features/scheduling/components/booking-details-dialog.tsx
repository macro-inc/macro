import External from '@phosphor/arrow-square-out.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Clock from '@phosphor/clock.svg';
import Globe from '@phosphor/globe-simple.svg';
import MapPin from '@phosphor/map-pin.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import X from '@phosphor/x.svg';
import { Button, Dialog } from '@ui';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { buttonClasses } from '@ui/components/Button';
import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import {
  bookingIsPast,
  bookingMeetingUrl,
  bookingTimeRange,
  canManageBooking,
} from '../core/booking-list';
import type { Booking, EventType, SchedulingMember } from '../core/types';
import { BookingStatus } from './booking-status';
import { SelectInput } from './fields';

function DetailField(props: {
  label: string;
  icon?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <dt class="flex items-center gap-2 text-sm text-ink-muted">
        {props.icon}
        {props.label}
      </dt>
      <dd class="min-w-0 break-words text-sm">{props.children}</dd>
    </div>
  );
}

function BookingActionFeedback(props: { busy: boolean; error?: string }) {
  return (
    <>
      <Show when={props.busy}>
        <p role="status" class="text-sm text-ink-muted">
          Updating booking…
        </p>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-sm text-failure">
          {props.error}
        </p>
      </Show>
    </>
  );
}
export function BookingDetailsDialog(props: {
  booking: Booking;
  event?: EventType;
  members: SchedulingMember[];
  timeZone: string;
  currentUserId: string;
  canManageBookings: boolean;
  busyId: string;
  error?: string;
  confirmCancel?: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onManage: (id: string) => void;
  onAttendance: (id: string, attendance: Booking['attendance']) => void;
}) {
  const [open, setOpen] = createSignal(true);
  const [confirmCancel, setConfirmCancel] = createSignal(!!props.confirmCancel);
  let confirmation: HTMLDivElement | undefined;
  let keepBookingButton: HTMLButtonElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  const confirmationTitleId = createUniqueId();
  const confirmationMessageId = createUniqueId();
  const past = () => bookingIsPast(props.booking, Date.now());
  const manageable = () =>
    canManageBooking(
      props.booking,
      props.canManageBookings,
      props.currentUserId,
      Date.now()
    );
  const join = () =>
    props.booking.status === 'confirmed' && !past()
      ? bookingMeetingUrl(props.booking.location)
      : undefined;
  const date = (value: string, timeZone = props.timeZone) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  const hosts = () =>
    props.booking.hosts
      .map((id) => {
        const member = props.members.find((member) => member.id === id);
        return member?.name || member?.email || 'Calendar host';
      })
      .join(', ');
  const answerLabel = (id: string) =>
    props.booking.questionLabels?.[id] ??
    props.event?.questions.find((question) => question.id === id)?.label ??
    'Additional response';
  const close = () => {
    if (!open()) return;
    setOpen(false);
    props.onClose();
  };
  const startCancelConfirmation = () => {
    if (!open() || !manageable() || props.busyId) return;
    setConfirmCancel(true);
    queueMicrotask(() => {
      if (!open() || !confirmCancel() || !keepBookingButton?.isConnected)
        return;
      confirmation?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      keepBookingButton.focus();
    });
  };
  const keepBooking = () => {
    setConfirmCancel(false);
    cancelButton?.focus();
  };
  return (
    <Dialog
      open={open()}
      onOpenChange={(next) => !next && close()}
      position="center"
      animate
      onCloseAutoFocus={(event) => {
        // The dialog has no shared trigger; return focus to its current card after the trap releases.
        event.preventDefault();
        queueMicrotask(props.onRestoreFocus);
      }}
      class="w-full max-w-[min(42rem,calc(100vw-16px))] overflow-hidden"
    >
      <ActionDialogShell class="@container/booking-details max-h-[calc(100dvh-16px)]">
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-edge-divider px-5 py-4">
          <Dialog.Title class="text-lg font-semibold">
            Booking details
          </Dialog.Title>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            label="Close booking details"
            tooltipDisabled
            onClick={close}
          >
            <X aria-hidden="true" class="size-4" />
          </Button>
        </div>
        <ActionDialogShell.Body class="min-h-0 overflow-y-auto">
          <Show when={!confirmCancel() || !manageable()}>
            <BookingActionFeedback
              busy={props.busyId === props.booking.id}
              error={props.error}
            />
          </Show>
          <Show when={confirmCancel() && manageable()}>
            <div
              ref={confirmation}
              class="flex flex-col gap-4 rounded-xl border border-edge-muted bg-surface-1 p-4"
            >
              <div class="text-sm">
                <p id={confirmationTitleId} class="font-medium">
                  {props.booking.status === 'pending'
                    ? 'Decline this booking request?'
                    : 'Cancel this booking?'}
                </p>
                <p id={confirmationMessageId} class="mt-1 text-ink-muted">
                  This releases the reserved time and cannot be undone.
                </p>
              </div>
              <BookingActionFeedback
                busy={props.busyId === props.booking.id}
                error={props.error}
              />
              <div class="flex flex-wrap justify-end gap-2">
                <Button
                  ref={keepBookingButton}
                  variant="ghost"
                  size="md"
                  aria-describedby={`${confirmationTitleId} ${confirmationMessageId}`}
                  disabled={!!props.busyId}
                  onClick={keepBooking}
                >
                  Keep booking
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  disabled={!!props.busyId}
                  onClick={() =>
                    manageable() &&
                    !props.busyId &&
                    props.onCancel(props.booking.id)
                  }
                >
                  {props.booking.status === 'pending'
                    ? 'Decline booking'
                    : 'Cancel booking'}
                </Button>
              </div>
            </div>
          </Show>
          <dl class="flex min-w-0 flex-col gap-6">
            <DetailField
              label="Meeting"
              icon={<Calendar aria-hidden="true" class="size-4" />}
            >
              <div class="flex min-w-0 items-start justify-between gap-3">
                <p class="min-w-0 flex-1 break-words text-lg font-medium">
                  {props.booking.title}
                </p>
                <div class="shrink-0">
                  <BookingStatus booking={props.booking} />
                </div>
              </div>
            </DetailField>
            <DetailField
              label="Guest"
              icon={<User aria-hidden="true" class="size-4" />}
            >
              <p>{props.booking.name}</p>
              <p class="mt-1 break-all text-ink-muted">{props.booking.email}</p>
            </DetailField>
            <div class="grid min-w-0 gap-6 sm:grid-cols-2">
              <DetailField
                label="When"
                icon={<Clock aria-hidden="true" class="size-4" />}
              >
                <p>{date(props.booking.startsAt)}</p>
                <p class="mt-1 text-ink-muted">
                  {bookingTimeRange(props.booking, props.timeZone)}
                </p>
              </DetailField>
              <Show when={hosts()}>
                <DetailField
                  label="Hosts"
                  icon={<Users aria-hidden="true" class="size-4" />}
                >
                  {hosts()}
                </DetailField>
              </Show>
            </div>
            <Show when={props.booking.location}>
              <DetailField
                label="Location"
                icon={<MapPin aria-hidden="true" class="size-4" />}
              >
                {props.booking.location}
              </DetailField>
            </Show>
            <DetailField
              label="Guest’s time zone"
              icon={<Globe aria-hidden="true" class="size-4" />}
            >
              <p>{props.booking.timeZone.replaceAll('_', ' ')}</p>
              <p class="mt-1 text-ink-muted">
                {date(props.booking.startsAt, props.booking.timeZone)} ·{' '}
                {bookingTimeRange(props.booking, props.booking.timeZone)}
              </p>
            </DetailField>
            <Show when={(props.booking.rescheduleCount ?? 0) > 0}>
              <DetailField label="Rescheduled">
                {props.booking.rescheduleCount}{' '}
                {props.booking.rescheduleCount === 1 ? 'time' : 'times'}
                <Show when={props.booking.rescheduledAt}>
                  {(at) => (
                    <p class="mt-1 text-ink-muted">Last changed {date(at())}</p>
                  )}
                </Show>
              </DetailField>
            </Show>
            <Show when={props.booking.status === 'confirmed' && past()}>
              <DetailField label="Attendance">
                <div class="max-w-56">
                  <SelectInput
                    label={`Attendance for ${props.booking.name}`}
                    value={props.booking.attendance ?? 'unknown'}
                    options={[
                      { value: 'unknown', label: 'Not recorded' },
                      { value: 'attended', label: 'Attended' },
                      { value: 'guestNoShow', label: 'Guest no-show' },
                      { value: 'hostNoShow', label: 'Host no-show' },
                    ]}
                    disabled={
                      (!props.canManageBookings &&
                        !props.booking.hosts.includes(props.currentUserId)) ||
                      !!props.busyId
                    }
                    onChange={(value) => {
                      if (
                        value === 'unknown' ||
                        value === 'attended' ||
                        value === 'guestNoShow' ||
                        value === 'hostNoShow'
                      )
                        props.onAttendance(props.booking.id, value);
                    }}
                  />
                </div>
              </DetailField>
            </Show>
            <For each={Object.entries(props.booking.answers)}>
              {([id, answer]) => (
                <DetailField label={answerLabel(id)}>
                  <p class="whitespace-pre-wrap">{answer || 'No response'}</p>
                </DetailField>
              )}
            </For>
          </dl>
          <Show
            when={
              props.booking.status === 'failed' ||
              props.booking.status === 'processing'
            }
          >
            <p class="text-sm text-ink-muted">
              {props.booking.status === 'failed'
                ? 'Calendar synchronization failed. This booking is not confirmed. Contact support before creating a replacement to avoid duplicate calendar events.'
                : 'This booking is still being synchronized with the calendar. It will appear in Upcoming once it is confirmed.'}
            </p>
          </Show>
        </ActionDialogShell.Body>
        <Show when={join() || manageable()}>
          <ActionDialogShell.Footer>
            <Show when={manageable()}>
              <Button
                ref={cancelButton}
                variant="danger"
                size="md"
                class="@max-[22rem]/booking-details:px-1.5 @max-[22rem]/booking-details:text-xs"
                disabled={!!props.busyId}
                onClick={startCancelConfirmation}
              >
                {props.booking.status === 'pending' ? 'Decline' : 'Cancel'}
              </Button>
              <Show when={!past()}>
                <Button
                  variant="outline"
                  size="md"
                  class="@max-[22rem]/booking-details:px-1.5 @max-[22rem]/booking-details:text-xs"
                  disabled={!!props.busyId}
                  onClick={() => props.onManage(props.booking.id)}
                >
                  Reschedule
                </Button>
              </Show>
            </Show>
            <Show when={join()}>
              {(url) => (
                <a
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class={buttonClasses({
                    variant: 'outline',
                    size: 'md',
                    class:
                      '@max-[22rem]/booking-details:gap-1 @max-[22rem]/booking-details:px-1.5 @max-[22rem]/booking-details:text-xs',
                  })}
                >
                  Join meeting
                  <External aria-hidden="true" class="size-3.5" />
                </a>
              )}
            </Show>
            <Show
              when={
                manageable() && !past() && props.booking.status === 'pending'
              }
            >
              <Button
                variant="strong"
                size="md"
                class="@max-[22rem]/booking-details:px-1.5 @max-[22rem]/booking-details:text-xs"
                disabled={!!props.busyId}
                onClick={() => props.onApprove(props.booking.id)}
              >
                Confirm
              </Button>
            </Show>
          </ActionDialogShell.Footer>
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
}
