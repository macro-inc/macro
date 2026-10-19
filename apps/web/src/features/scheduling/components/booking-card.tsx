import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MENU_ITEM_CLASS,
  MenuGroup,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ContextMenu } from '@kobalte/core/context-menu';
import External from '@phosphor/arrow-square-out.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Check from '@phosphor/check.svg';
import Clock from '@phosphor/clock.svg';
import Dots from '@phosphor/dots-three.svg';

import Info from '@phosphor/info.svg';
import MapPin from '@phosphor/map-pin.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import Timer from '@phosphor/timer.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import X from '@phosphor/x.svg';
import { Button, cn, Dropdown } from '@ui';
import { buttonClasses } from '@ui/components/Button';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import {
  bookingIsPast,
  bookingMeetingUrl,
  bookingTimeRangeDisplay,
  canManageBooking,
} from '../core/booking-list';
import type { Booking } from '../core/types';
import { BookingStatus } from './booking-status';
import { SchedulingDrawerHeader } from './scheduling-drawer-header';

export function BookingCard(props: {
  booking: Booking;
  timeZone: string;
  canManageBookings: boolean;
  currentUserId: string;
  busyId: string;
  hostNames: string;
  onView: (
    booking: Booking,
    opener?: HTMLElement,
    confirmCancel?: boolean
  ) => void;
  onApprove: (id: string) => void;
  onManage: (id: string) => void;
}) {
  let opener: HTMLButtonElement | undefined;
  let pendingDetails: boolean | undefined;
  const [drawerMounted, setDrawerMounted] = createSignal(false);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  let drawerAction: (() => void) | undefined;
  const openDrawer = () => {
    drawerAction = undefined;
    setDrawerMounted(true);
    setDrawerOpen(true);
  };
  const finishDrawerClose = (present: boolean) => {
    if (present || drawerOpen()) return;
    // Let Corvu finish its presence update before disposing the drawer.
    queueMicrotask(() => {
      if (disposed || drawerOpen()) return;
      const action = drawerAction;
      drawerAction = undefined;
      setDrawerMounted(false);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      if (action) {
        queueMicrotask(() => {
          if (!disposed) action();
        });
      }
    });
  };
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const finishMenuClose = (event: Event) => {
    if (pendingDetails === undefined) return;
    event.preventDefault();
    const confirmCancel = pendingDetails;
    pendingDetails = undefined;
    // Release the menu's modal lock before opening a dialog or touch drawer.
    queueMicrotask(() => {
      if (!disposed) props.onView(props.booking, opener, confirmCancel);
    });
  };
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
  const duration = () =>
    Math.round(
      (Date.parse(props.booking.endsAt) - Date.parse(props.booking.startsAt)) /
        60000
    );
  const time = createMemo(() =>
    bookingTimeRangeDisplay(props.booking, props.timeZone)
  );
  const date = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: props.timeZone,
      ...options,
    }).format(new Date(props.booking.startsAt));
  function MenuItems(menu: { context?: boolean; drawer?: boolean }) {
    const MenuItem = menu.context ? ContextMenu.Item : Dropdown.Item;
    const Group = menu.drawer
      ? MobileDrawer.Section
      : menu.context
        ? MenuGroup
        : Dropdown.Group;
    const Item = (item: {
      children: JSX.Element;
      onSelect: () => void;
      disabled?: boolean;
      class?: string;
      immediate?: boolean;
    }) => (
      <Show
        when={menu.drawer}
        fallback={
          <MenuItem
            class={item.class}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.children}
          </MenuItem>
        }
      >
        <MobileDrawer.Item
          disabled={item.disabled}
          class={item.class}
          onClick={() => {
            if (item.immediate) item.onSelect();
            else drawerAction = item.onSelect;
            setDrawerOpen(false);
          }}
        >
          {item.children}
        </MobileDrawer.Item>
      </Show>
    );
    const showDetails = (confirmCancel: boolean) => {
      if (confirmCancel && (props.busyId || !manageable())) return;
      if (menu.drawer) props.onView(props.booking, opener, confirmCancel);
      else pendingDetails = confirmCancel;
    };
    return (
      <>
        <Group>
          <Item
            class={menu.context ? MENU_ITEM_CLASS : undefined}
            onSelect={() => showDetails(false)}
          >
            <Info class="size-4" /> Details
          </Item>
          <Show when={join()}>
            {(url) => (
              <Item
                class={menu.context ? MENU_ITEM_CLASS : undefined}
                immediate
                onSelect={() => {
                  window.open(url(), '_blank', 'noopener,noreferrer');
                }}
              >
                <External class="size-4" /> Join meeting
              </Item>
            )}
          </Show>
        </Group>
        <Show when={manageable()}>
          <Group>
            <Show when={!past()}>
              <Show when={props.booking.status === 'pending'}>
                <Item
                  class={menu.context ? MENU_ITEM_CLASS : undefined}
                  disabled={!!props.busyId}
                  onSelect={() => {
                    if (!props.busyId && manageable())
                      props.onApprove(props.booking.id);
                  }}
                >
                  <Check class="size-4" /> Confirm
                </Item>
              </Show>
              <Item
                class={menu.context ? MENU_ITEM_CLASS : undefined}
                disabled={!!props.busyId}
                onSelect={() => {
                  if (!props.busyId && manageable())
                    props.onManage(props.booking.id);
                }}
              >
                <Calendar class="size-4" /> Reschedule
              </Item>
            </Show>
            <Item
              class={cn(menu.context && MENU_ITEM_CLASS, 'text-failure')}
              disabled={!!props.busyId}
              onSelect={() => showDetails(true)}
            >
              <X class="size-4" />{' '}
              {props.booking.status === 'pending' ? 'Decline' : 'Cancel'}
            </Item>
          </Group>
        </Show>
      </>
    );
  }
  const location = () => {
    const url = bookingMeetingUrl(props.booking.location);
    return url ? new URL(url).hostname : props.booking.location;
  };
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          as="article"
          disabled={isTouchDevice()}
          ref={(element: HTMLElement) => {
            touchHandler(element, () => ({ onLongPress: openDrawer }));
          }}
          onContextMenu={(event) => {
            if (!isTouchDevice()) return;
            event.preventDefault();
            event.stopPropagation();
            openDrawer();
          }}
          class="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-3 gap-y-4 rounded-xl border border-edge-frame bg-panel p-4 transition-colors hover:bg-list-hover focus-within:border-edge-focus @min-[20rem]/bookings:grid-cols-[112px_minmax(0,1fr)] @min-[36rem]/bookings:grid-cols-[144px_minmax(0,1fr)] @min-[36rem]/bookings:gap-x-4 @min-[42rem]/bookings:grid-cols-[144px_minmax(0,1fr)_auto]"
          classList={{ 'opacity-50': props.booking.status === 'cancelled' }}
        >
          <button
            ref={opener}
            type="button"
            data-booking-opener={props.booking.id}
            aria-label={`${props.booking.title} with ${props.booking.name}, ${date({ dateStyle: 'full' })}`}
            aria-keyshortcuts="Shift+F10"
            onKeyDown={(event) => {
              if (
                event.key !== 'ContextMenu' &&
                !(event.shiftKey && event.key === 'F10')
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              if (isTouchDevice()) {
                openDrawer();
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: bounds.left,
                  clientY: bounds.bottom,
                })
              );
            }}
            onClick={(event) =>
              props.onView(props.booking, event.currentTarget)
            }
            class="col-start-1 col-end-3 row-start-1 row-end-3 grid min-w-0 grid-cols-subgrid grid-rows-subgrid items-start rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent @min-[42rem]/bookings:col-end-4"
          >
            <div class="col-start-1 row-start-1 row-end-3 pt-0.5">
              <div class="mb-3 flex min-w-0">
                <BookingStatus
                  booking={props.booking}
                  class="h-auto justify-start whitespace-normal border-0 p-0 text-xs"
                />
              </div>
              <p class="text-xs font-medium text-ink-muted">
                {date({ weekday: 'long' })}
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums">
                {date({ month: 'short', day: 'numeric' })}
              </p>
              <p class="mt-1 text-xs text-ink-muted">
                {date({ year: 'numeric' })}
              </p>
            </div>
            <div class="col-start-2 col-end-3 row-start-1 flex min-w-0 flex-col gap-4 @min-[42rem]/bookings:col-end-4">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h3 class="flex min-w-0 max-w-full items-start gap-1.5 text-xl font-medium">
                  <TextAlignLeft
                    aria-hidden="true"
                    class="mt-1.5 size-4 shrink-0 text-ink-muted"
                  />
                  <span class="min-w-0 break-words">{props.booking.title}</span>
                </h3>
                <Show when={(props.booking.rescheduleCount ?? 0) > 0}>
                  <span class="text-xs text-ink-muted">Rescheduled</span>
                </Show>
              </div>
              <div class="flex min-w-0 flex-col gap-1 text-sm">
                <p class="flex min-w-0 items-start gap-1.5 font-medium">
                  <User
                    aria-hidden="true"
                    class="mt-0.5 size-3.5 shrink-0 text-ink-muted"
                  />
                  <span class="min-w-0 break-words">{props.booking.name}</span>
                </p>
                <p class="break-all pl-5 text-ink-muted">
                  {props.booking.email}
                </p>
              </div>
            </div>
            <div class="col-start-2 row-start-2 flex min-h-8 min-w-0 flex-wrap items-center gap-4 text-xs text-ink-muted">
              <div class="flex min-w-0 max-w-full shrink-0 items-start gap-1.5">
                <Clock aria-hidden="true" class="mt-0.5 size-3.5 shrink-0" />
                <div class="min-w-0">
                  <div class="flex flex-wrap gap-x-1">
                    <span class="flex flex-wrap gap-x-1">
                      <span class="whitespace-nowrap">{time().start.time}</span>
                      <span class="whitespace-nowrap">
                        <Show when={!time().sharedTimeZone}>
                          {time().start.timeZone}{' '}
                        </Show>
                        –
                      </span>
                    </span>
                    <span class="flex flex-wrap gap-x-1">
                      <span class="whitespace-nowrap">{time().end.time}</span>
                      <Show when={!time().sharedTimeZone}>
                        <span class="whitespace-nowrap">
                          {time().end.timeZone}
                        </span>
                      </Show>
                    </span>
                    <Show when={time().sharedTimeZone}>
                      <span class="whitespace-nowrap">
                        {time().start.timeZone}
                      </span>
                    </Show>
                  </div>
                  <Show when={time().endDate}>
                    <span class="block">Ends {time().endDate}</span>
                  </Show>
                </div>
              </div>
              <span class="flex items-center gap-1.5 whitespace-nowrap">
                <Timer aria-hidden="true" class="size-3.5 shrink-0" />
                {duration()} mins
              </span>
              <Show when={props.hostNames}>
                <span class="flex min-w-0 max-w-full shrink-0 items-center gap-1.5">
                  <Users aria-hidden="true" class="size-3.5 shrink-0" />
                  <span class="min-w-0 break-words">{props.hostNames}</span>
                </span>
              </Show>
              <Show when={location()}>
                <span class="flex min-w-0 max-w-full shrink-0 items-center gap-1.5">
                  <MapPin aria-hidden="true" class="size-3.5 shrink-0" />
                  <span class="min-w-0 break-words">{location()}</span>
                </span>
              </Show>
            </div>
          </button>
          <div class="col-start-1 col-end-3 row-start-3 flex min-w-0 items-center justify-end gap-2 self-start @min-[42rem]/bookings:col-start-3 @min-[42rem]/bookings:col-end-4 @min-[42rem]/bookings:row-start-2">
            <Dropdown>
              <Dropdown.Trigger
                variant="ghost"
                size="icon-md"
                label={`Options for ${props.booking.name}`}
                class="touch:hidden"
                tooltipDisabled
              >
                <Dots class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content
                class="min-w-40"
                onCloseAutoFocus={finishMenuClose}
              >
                <MenuItems />
              </Dropdown.Content>
            </Dropdown>
            <Show when={join()}>
              {(url) => (
                <a
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class={buttonClasses({
                    variant: 'outline',
                    size: 'md',
                  })}
                >
                  <External aria-hidden="true" class="size-3.5" />
                  Join meeting
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
                disabled={!!props.busyId}
                onClick={() => props.onApprove(props.booking.id)}
              >
                Confirm
              </Button>
            </Show>
          </div>
          <Show when={props.busyId === props.booking.id}>
            <span role="status" class="col-span-2 text-xs text-ink-muted">
              Updating booking…
            </span>
          </Show>
        </ContextMenuTrigger>
        <ContextMenu.Portal>
          <ContextMenuContent
            class="min-w-40"
            onCloseAutoFocus={finishMenuClose}
          >
            <MenuItems context />
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
      <Show when={drawerMounted()}>
        <MobileDrawer
          side="bottom"
          open={drawerOpen()}
          onOpenChange={setDrawerOpen}
          onContentPresentChange={finishDrawerClose}
          closeOnOutsidePointerStrategy="pointerdown"
          preventScroll={false}
          preventScrollbarShift={false}
          restoreFocus={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Booking actions">
              <MobileDrawer.Handle class="pb-1" />
              <SchedulingDrawerHeader
                title={props.booking.title}
                closeLabel="Close booking actions"
                onClose={() => setDrawerOpen(false)}
              />
              <MobileDrawer.ScrollBody
                data-corvu-no-drag
                class="touch-pan-y overscroll-contain gap-3"
              >
                <MenuItems drawer />
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </>
  );
}
