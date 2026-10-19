import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { touchHandler } from '@core/directive/touchHandler';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Popover } from '@kobalte/core/popover';
import Calendar from '@phosphor/calendar-blank.svg';
import CalendarCheck from '@phosphor/calendar-check.svg';
import Check from '@phosphor/check.svg';
import Clock from '@phosphor/clock.svg';
import Copy from '@phosphor/copy.svg';
import Dots from '@phosphor/dots-three.svg';
import Eye from '@phosphor/eye.svg';
import Globe from '@phosphor/globe.svg';
import Link from '@phosphor/link.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash.svg';
import { Badge, Button, ConfirmDialog, Dropdown, Tooltip } from '@ui';
import {
  batch,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import { getDefaultCalendarTimeFormat } from '../../calendar/utils/time-format';
import {
  type AvailabilityTimeFormat,
  availabilityTimeLabel,
  formatAvailabilityDate,
} from '../core/availability-month';
import {
  type AvailabilityHours,
  availabilityRuleHours,
} from '../core/availability-selection';
import {
  type AvailabilityWeekGroup,
  availabilityWeekGroups,
} from '../core/availability-summary';
import type { AvailabilitySchedule, SchedulingProfile } from '../core/types';
import { WEEKDAYS } from '../core/types';
import { AvailabilityHoursSummary } from './availability-hours-summary';
import { SchedulingDrawerHeader } from './scheduling-drawer-header';

function dayGroupLabel(days: number[]) {
  const shortName = (day: number) => WEEKDAYS[day].slice(0, 3);
  if (days.length === 7) return 'Every day';
  if (days.length === 1) return shortName(days[0]);
  return `${shortName(days[0])}–${shortName(days[days.length - 1])}`;
}

function hoursLabel(
  hours: AvailabilityHours,
  timeFormat: AvailabilityTimeFormat
) {
  return (
    [
      ...hours.windows.map((window) =>
        availabilityTimeLabel(window, timeFormat)
      ),
      ...hours.unavailableWindows.map(
        (window) => `Unavailable ${availabilityTimeLabel(window, timeFormat)}`
      ),
    ].join(', ') || 'Not set'
  );
}

export function AvailabilityPanel(props: {
  profile: SchedulingProfile;
  search?: string;
  canEdit: boolean;
  saving: boolean;
  onEdit: (schedule: AvailabilitySchedule, opener?: HTMLElement) => void;
  onDefault: (schedule: AvailabilitySchedule) => void;
  onDelete: (schedule: AvailabilitySchedule) => void;
}) {
  const [remove, setRemove] = createSignal<string>();
  let panel: HTMLDivElement | undefined;
  let dialogOpener: HTMLButtonElement | undefined;
  const [drawerSelection, setDrawerSelection] = createSignal<{
    id: string;
    opener?: HTMLButtonElement;
  }>();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  let drawerAction: (() => void) | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const drawerSchedule = () =>
    props.profile.schedules.find(
      (schedule) => schedule.id === drawerSelection()?.id
    );
  const drawerIsOpen = () => props.canEdit && drawerOpen();
  const openDrawer = (
    schedule: AvailabilitySchedule,
    opener?: HTMLButtonElement
  ) => {
    if (!props.canEdit || props.saving) return;
    drawerAction = undefined;
    batch(() => {
      setDrawerSelection({ id: schedule.id, opener });
      setDrawerOpen(true);
    });
  };
  const finishDrawerClose = (present: boolean) => {
    if (present || drawerIsOpen()) return;
    // Release the drawer's modal lock before opening an editor or confirmation.
    queueMicrotask(() => {
      if (disposed || drawerIsOpen()) return;
      const opener = drawerSelection()?.opener;
      const action = drawerAction;
      const canRun = props.canEdit && !props.saving && !!drawerSchedule();
      drawerAction = undefined;
      setDrawerSelection(undefined);
      const target = opener?.isConnected && !opener.disabled ? opener : panel;
      target?.focus({ preventScroll: true });
      if (action && canRun)
        queueMicrotask(() => {
          if (!disposed) action();
        });
    });
  };
  const timeFormat: AvailabilityTimeFormat =
    getDefaultCalendarTimeFormat() === '24-hour' ? '24h' : '12h';
  const defaultId = () =>
    props.profile.defaultScheduleId ?? props.profile.schedules[0]?.id;
  const usedBy = (id: string) =>
    props.profile.eventTypes.filter((event) => event.scheduleId === id);
  const filtered = () => {
    const query = props.search?.trim().toLowerCase() ?? '';
    return props.profile.schedules.filter((schedule) =>
      `${schedule.name} ${schedule.timeZone.replaceAll('_', ' ')}`
        .toLowerCase()
        .includes(query)
    );
  };
  const removing = () =>
    props.profile.schedules.find((schedule) => schedule.id === remove());
  const removalBlocked = () => !!usedBy(remove() ?? '').length;
  function MenuItems(menu: {
    schedule: AvailabilitySchedule;
    opener?: HTMLButtonElement;
    drawer?: boolean;
  }) {
    const Group = menu.drawer ? MobileDrawer.Section : Dropdown.Group;
    const Item = (item: {
      children: JSX.Element;
      onSelect: (
        schedule: AvailabilitySchedule,
        opener?: HTMLButtonElement
      ) => void;
      class?: string;
    }) => (
      <Show
        when={menu.drawer}
        fallback={
          <Dropdown.Item
            class={item.class}
            disabled={props.saving}
            onSelect={() => item.onSelect(menu.schedule, menu.opener)}
          >
            {item.children}
          </Dropdown.Item>
        }
      >
        <MobileDrawer.Item
          class={item.class}
          disabled={props.saving}
          onClick={() => {
            const schedule = menu.schedule;
            const opener = menu.opener;
            drawerAction = () => item.onSelect(schedule, opener);
            setDrawerOpen(false);
          }}
        >
          {item.children}
        </MobileDrawer.Item>
      </Show>
    );
    return (
      <>
        <Group>
          <Show when={defaultId() !== menu.schedule.id}>
            <Item onSelect={(schedule) => props.onDefault(schedule)}>
              <Check class="size-4" />
              Set as default
            </Item>
          </Show>
          <Item
            onSelect={(schedule, opener) =>
              props.onEdit(
                {
                  ...structuredClone(unwrap(schedule)),
                  id: crypto.randomUUID(),
                  name: `${schedule.name.slice(0, 93)} (copy)`,
                },
                opener
              )
            }
          >
            <Copy class="size-4" />
            Copy schedule
          </Item>
        </Group>
        <Group>
          <Item
            class="text-failure"
            onSelect={(schedule, opener) => {
              dialogOpener = opener;
              setRemove(schedule.id);
            }}
          >
            <Trash class="size-4" />
            Delete
          </Item>
        </Group>
      </>
    );
  }
  return (
    <div
      ref={panel}
      tabindex="-1"
      role="region"
      aria-label="Availability schedules"
      class="@container/availability-cards min-w-0 outline-none"
    >
      <div class="grid min-w-0 gap-4 @min-[44rem]/availability-cards:grid-cols-2 @min-[76rem]/availability-cards:grid-cols-3">
        <For
          each={filtered()}
          fallback={
            <div class="col-span-full flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge px-6 py-12 text-center">
              <Calendar class="size-8 text-ink-muted" />
              <h2 class="font-semibold">
                {props.search?.trim()
                  ? 'No matching schedules'
                  : 'Set your working hours'}
              </h2>
              <p class="max-w-sm text-sm text-ink-muted">
                {props.search?.trim()
                  ? 'Try a different schedule name or time zone.'
                  : 'Create a schedule to start accepting bookings.'}
              </p>
            </div>
          }
        >
          {(schedule) => {
            let actionsButton: HTMLButtonElement | undefined;
            let nameButton: HTMLButtonElement | undefined;
            const groups = createMemo(() => availabilityWeekGroups(schedule));
            const week = () =>
              groups().flatMap((group) =>
                group.days.map((day) => ({ day, hours: group.hours }))
              );
            const links = () => usedBy(schedule.id);
            return (
              <article
                ref={(element) => {
                  touchHandler(element, () => ({
                    onLongPress: () => openDrawer(schedule, nameButton),
                  }));
                }}
                onContextMenu={(event) => {
                  if (!isTouchDevice()) return;
                  event.preventDefault();
                  event.stopPropagation();
                  openDrawer(schedule, nameButton);
                }}
                aria-label={schedule.name}
                class="flex min-w-0 flex-col rounded-2xl border border-edge-muted bg-panel transition-colors hover:border-edge"
              >
                <div class="flex min-w-0 flex-col gap-5 p-5">
                  <div class="flex min-h-14 min-w-0 items-start gap-3">
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-1 text-ink-muted">
                      <Calendar class="size-5" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 class="min-w-0 max-w-full text-base font-semibold text-ink">
                          <Tooltip
                            label={schedule.name}
                            class="min-w-0 max-w-full"
                          >
                            <button
                              ref={nameButton}
                              aria-keyshortcuts="Shift+F10"
                              onKeyDown={(event) => {
                                if (
                                  !isTouchDevice() ||
                                  (event.key !== 'ContextMenu' &&
                                    !(event.shiftKey && event.key === 'F10'))
                                )
                                  return;
                                event.preventDefault();
                                event.stopPropagation();
                                openDrawer(schedule, event.currentTarget);
                              }}
                              type="button"
                              class="line-clamp-2 max-w-full rounded-sm text-left wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              disabled={!props.canEdit || props.saving}
                              onClick={(event) =>
                                props.onEdit(schedule, event.currentTarget)
                              }
                            >
                              {schedule.name}
                            </button>
                          </Tooltip>
                        </h2>
                        <Show when={defaultId() === schedule.id}>
                          <Badge variant="outline" class="gap-1 text-xs">
                            <Check class="size-3" />
                            Default
                          </Badge>
                        </Show>
                      </div>
                      <Tooltip
                        label={schedule.timeZone.replaceAll('_', ' ')}
                        class="mt-1 max-w-full gap-1.5 text-xs text-ink-muted"
                      >
                        <Globe class="size-3.5 shrink-0" />
                        <span class="truncate">
                          {schedule.timeZone.replaceAll('_', ' ')}
                        </span>
                      </Tooltip>
                    </div>
                    <Show when={props.canEdit}>
                      <Dropdown>
                        <Dropdown.Trigger
                          ref={actionsButton}
                          variant="ghost"
                          size="icon-sm"
                          label={`Actions for ${schedule.name}`}
                          disabled={props.saving}
                          class="shrink-0 touch:hidden"
                        >
                          <Dots class="size-5" />
                        </Dropdown.Trigger>
                        <Dropdown.Content>
                          <MenuItems
                            schedule={schedule}
                            opener={actionsButton}
                          />
                        </Dropdown.Content>
                      </Dropdown>
                    </Show>
                  </div>
                  <div
                    class="grid grid-cols-7 gap-1.5"
                    role="group"
                    aria-label="Weekly availability"
                  >
                    <For each={week()}>
                      {({ day, hours }) => (
                        <Tooltip
                          label={`${WEEKDAYS[day]}: ${hoursLabel(hours, timeFormat)}`}
                          class="flex-col justify-center gap-2 rounded-lg border border-edge-muted bg-surface-1/40 px-1 py-2 text-xs"
                        >
                          <span class="sr-only">
                            {WEEKDAYS[day]}: {hoursLabel(hours, timeFormat)}
                          </span>
                          <span
                            aria-hidden="true"
                            class="font-medium"
                            classList={{
                              'text-ink': hours.windows.length > 0,
                              'text-ink-muted': !hours.windows.length,
                            }}
                          >
                            {WEEKDAYS[day].slice(0, 3)}
                          </span>
                          <span
                            aria-hidden="true"
                            class="h-1 w-4 rounded-full"
                            classList={{
                              'bg-accent': hours.windows.length > 0,
                              'bg-ink-extra-muted':
                                !hours.windows.length &&
                                hours.unavailableWindows.length > 0,
                              'bg-edge-muted':
                                !hours.windows.length &&
                                !hours.unavailableWindows.length,
                            }}
                          />
                        </Tooltip>
                      )}
                    </For>
                  </div>
                  <dl class="flex min-h-18 min-w-0 flex-col gap-2 text-xs">
                    <For each={groups().slice(0, 3)}>
                      {(group) => (
                        <div class="flex min-w-0 items-start justify-between gap-3">
                          <dt class="shrink-0 text-ink-muted">
                            {dayGroupLabel(group.days)}
                          </dt>
                          <dd class="min-w-0 flex-1 text-right tabular-nums">
                            <Tooltip
                              label={hoursLabel(group.hours, timeFormat)}
                              class="min-w-0 max-w-full"
                            >
                              <span class="min-w-0 truncate">
                                {hoursLabel(group.hours, timeFormat)}
                              </span>
                            </Tooltip>
                          </dd>
                        </div>
                      )}
                    </For>
                    <Show when={groups().length > 3}>
                      <div>
                        <dt class="sr-only">Additional hours</dt>
                        <dd class="text-ink-muted">
                          +{groups().length - 3} more in preview
                        </dd>
                      </div>
                    </Show>
                  </dl>
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
                    <span class="inline-flex items-center gap-1.5">
                      <Link class="size-3.5" />
                      {links().length}{' '}
                      {links().length === 1 ? 'booking link' : 'booking links'}
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                      <CalendarCheck class="size-3.5" />
                      {schedule.overrides.length}{' '}
                      {schedule.overrides.length === 1
                        ? 'date exception'
                        : 'date exceptions'}
                    </span>
                  </div>
                </div>
                <div class="mt-auto flex items-center justify-between gap-3 border-t border-edge-muted px-4 py-3">
                  <SchedulePreview
                    schedule={schedule}
                    groups={groups()}
                    timeFormat={timeFormat}
                  />
                  <Show when={props.canEdit}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={props.saving}
                      onClick={(event) =>
                        props.onEdit(schedule, event.currentTarget)
                      }
                    >
                      <Pencil class="size-3.5" />
                      Edit schedule
                    </Button>
                  </Show>
                </div>
              </article>
            );
          }}
        </For>
      </div>
      <Show when={drawerSelection()}>
        <MobileDrawer
          side="bottom"
          open={drawerIsOpen()}
          onOpenChange={setDrawerOpen}
          onContentPresentChange={finishDrawerClose}
          closeOnOutsidePointerStrategy="pointerdown"
          preventScroll={false}
          preventScrollbarShift={false}
          restoreFocus={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Schedule actions">
              <MobileDrawer.Handle class="pb-1" />
              <SchedulingDrawerHeader
                title={drawerSchedule()?.name ?? 'Schedule'}
                closeLabel="Close schedule actions"
                onClose={() => setDrawerOpen(false)}
              />
              <MobileDrawer.ScrollBody
                data-corvu-no-drag
                class="touch-pan-y overscroll-contain gap-3"
              >
                <Show when={drawerSchedule()}>
                  {(schedule) => (
                    <MenuItems
                      schedule={schedule()}
                      opener={drawerSelection()?.opener}
                      drawer
                    />
                  )}
                </Show>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
      <ConfirmDialog
        open={props.canEdit && !!removing()}
        title={removalBlocked() ? 'Schedule is in use' : 'Delete schedule?'}
        body={
          removalBlocked()
            ? `Move ${usedBy(remove() ?? '')
                .map((event) => event.title)
                .join(', ')} to another schedule before deleting this one.`
            : `Delete “${removing()?.name ?? ''}”? This cannot be undone.`
        }
        confirmLabel={removalBlocked() ? 'Got it' : 'Delete schedule'}
        cancelLabel="Cancel"
        tone={removalBlocked() ? 'default' : 'danger'}
        pending={props.saving}
        onOpenChange={(open) => {
          if (!open) setRemove(undefined);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target =
            dialogOpener?.isConnected && !dialogOpener.matches(':disabled')
              ? dialogOpener
              : panel;
          target?.focus({ preventScroll: true });
        }}
        onConfirm={() => {
          const schedule = removing();
          if (!props.canEdit || props.saving || !schedule) return;
          setRemove(undefined);
          if (!usedBy(schedule.id).length) props.onDelete(schedule);
        }}
      />
    </div>
  );
}

function SchedulePreview(props: {
  schedule: AvailabilitySchedule;
  groups: AvailabilityWeekGroup[];
  timeFormat: AvailabilityTimeFormat;
}) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={8}
      modal={false}
    >
      <Popover.Trigger
        as={Button}
        ref={setTrigger}
        variant="ghost"
        size="sm"
        label={`Preview ${props.schedule.name}`}
      >
        <Eye class="size-3.5" />
        Preview
      </Popover.Trigger>
      <Popover.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Popover.Content class="menu-surface z-action-menu flex max-h-[min(32rem,var(--kb-popper-content-available-height))] w-96 max-w-[min(24rem,var(--kb-popper-content-available-width),calc(100vw-2rem))] flex-col overflow-hidden text-xs outline-none">
          <div class="shrink-0 border-b border-edge-muted p-4">
            <Popover.Title class="break-words text-base font-semibold">
              {props.schedule.name}
            </Popover.Title>
            <Popover.Description class="mt-1 flex items-center gap-1.5 text-ink-muted">
              <Globe class="size-3.5 shrink-0" />
              {props.schedule.timeZone.replaceAll('_', ' ')}
            </Popover.Description>
          </div>
          <div class="min-h-0 overflow-y-auto overscroll-contain p-4">
            <h3 class="mb-3 flex items-center gap-2 font-medium text-ink-muted">
              <Clock class="size-4" />
              Weekly hours
            </h3>
            <dl class="flex flex-col gap-3">
              <For each={props.groups}>
                {(group) => (
                  <For each={group.days}>
                    {(day) => (
                      <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-4">
                        <dt class="pt-0.5 text-ink-muted">{WEEKDAYS[day]}</dt>
                        <dd>
                          <AvailabilityHoursSummary
                            hours={group.hours}
                            timeFormat={props.timeFormat}
                          />
                        </dd>
                      </div>
                    )}
                  </For>
                )}
              </For>
            </dl>
            <Show when={props.schedule.overrides.length}>
              <div class="mt-4 border-t border-edge-muted pt-4">
                <h3 class="mb-3 flex items-center gap-2 font-medium text-ink-muted">
                  <CalendarCheck class="size-4" />
                  Date exceptions
                </h3>
                <dl class="flex flex-col gap-4">
                  <For
                    each={[...props.schedule.overrides].sort((a, b) =>
                      a.date.localeCompare(b.date)
                    )}
                  >
                    {(override) => (
                      <div class="flex flex-col gap-1.5">
                        <dt class="font-medium">
                          {formatAvailabilityDate(override.date)}
                        </dt>
                        <dd>
                          <AvailabilityHoursSummary
                            hours={availabilityRuleHours(props.schedule, {
                              kind: 'date',
                              date: override.date,
                            })}
                            timeFormat={props.timeFormat}
                          />
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
