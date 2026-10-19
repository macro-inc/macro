import { SearchBar, ViewShell, ViewSidebar } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import PageIcon from '@phosphor/browser.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChartIcon from '@phosphor/chart-bar.svg';
import CheckIcon from '@phosphor/check.svg';
import ClockIcon from '@phosphor/clock.svg';
import InfoIcon from '@phosphor/info.svg';
import LinkIcon from '@phosphor/link.svg';
import PlusIcon from '@phosphor/plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import UserIcon from '@phosphor/user.svg';
import UsersIcon from '@phosphor/users.svg';
import { Button, cn, pressHandlers } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  mapArray,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { BookingLinksState } from '../booking-links-search';
import { AvailabilityTopBar } from '../components/availability-topbar';
import { BookingPageLeaveDialog } from '../components/booking-page-leave-dialog';
import { BookingsDateRange } from '../components/bookings-date-range';
import { OwnerBadge } from '../components/owner-badge';
import { useScheduling } from '../context/scheduling-context';
import { reportDate, shiftReportDate } from '../core/insights';
import { createBookingPageLeave } from '../primitives/create-booking-page-leave';
import { createSchedulingOwner } from '../primitives/create-scheduling-owner';
import { OwnerSettingsSection } from './owner-settings-section';
import { SchedulingMobileHeader } from './scheduling-mobile-header';

const TABS = [
  {
    value: 'links' as const,
    label: 'Booking links',
    icon: LinkIcon,
    description:
      'Create a link, set your availability, and let people book time with you.',
  },
  {
    value: 'availability' as const,
    label: 'Availability',
    icon: ClockIcon,
    description:
      'Set your working hours and make exceptions for specific dates.',
  },
  {
    value: 'bookings' as const,
    label: 'Bookings',
    icon: CalendarIcon,
    description: 'Upcoming and past meetings booked through your links.',
  },
  {
    value: 'insights' as const,
    label: 'Insights',
    icon: ChartIcon,
    description: 'Understand how your booking links are being used.',
  },
  {
    value: 'page' as const,
    label: 'Booking page',
    icon: PageIcon,
    description:
      'Customize your public booking page, preview it, and share its link.',
  },
];

export function BookingWorkspaceView(props: {
  search: BookingLinksState;
  onSearchChange: (patch: Partial<BookingLinksState>) => void;
  registerBeforeLeave?: (
    guard: (signal: AbortSignal) => boolean | Promise<boolean>
  ) => void | (() => void);
}) {
  const capabilities = useScheduling();
  const search = props.search;
  const setSearch = props.onSearchChange;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = reportDate(new Date(), zone);
  const [from, setFrom] = createSignal(shiftReportDate(today, -30));
  const [to, setTo] = createSignal(shiftReportDate(today, 30));
  const [query, setQuery] = createSignal('');
  const [bookingsSearch, setBookingsSearch] = createSignal('');
  const [availabilitySearch, setAvailabilitySearch] = createSignal('');
  const [startingAgent, setStartingAgent] = createSignal(false);
  const scopes = createMemo(() => {
    const available = capabilities.scopes();
    return [
      ...available.filter((scope) => !scope.teamId),
      ...available.filter((scope) => scope.teamId),
    ];
  });
  const selectedOwnerId = () =>
    scopes().some((scope) => scope.id === search.owner)
      ? search.owner
      : scopes()[0]?.id;
  const owners = createMemo(
    mapArray(
      () => scopes().map((scope) => scope.id),
      (id) =>
        createSchedulingOwner(
          capabilities,
          () => scopes().find((scope) => scope.id === id)!,
          () => ({
            from: new Date(`${from()}T00:00:00`).toISOString(),
            to: new Date(`${shiftReportDate(to(), 1)}T00:00:00`).toISOString(),
          }),
          () => search.tab === 'bookings' && selectedOwnerId() === id
        )
    )
  );
  const owner = () =>
    owners().find((item) => item.scope().id === selectedOwnerId()) ??
    owners()[0];
  const tab = () => TABS.find((item) => item.value === search.tab) ?? TABS[0];
  const editingSchedule = () =>
    search.tab === 'availability' && !!owner()?.schedule();
  const isSaving = () => owners().some((item) => item.source.saving());
  const discardEditors = () => {
    for (const current of owners()) current.discardEditors();
  };
  const dirtyOwners = () =>
    owners().filter((current) => current.hasProfileChanges());
  const hasPageChanges = () => dirtyOwners().length > 0;
  const pageLeave = createBookingPageLeave({
    dirty: hasPageChanges,
    busy: isSaving,
    save: async () => {
      for (const current of dirtyOwners()) await current.saveProfile();
    },
    discard: () => {
      for (const current of dirtyOwners()) current.revertProfile();
    },
  });
  const unregisterBeforeLeave = props.registerBeforeLeave?.(
    pageLeave.requestLeave
  );
  if (unregisterBeforeLeave) onCleanup(unregisterBeforeLeave);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasPageChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  createEffect(() => {
    if (!hasPageChanges()) return;
    window.addEventListener('beforeunload', beforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload));
  });
  const commitSelection = (patch: Partial<BookingLinksState>) => {
    discardEditors();
    setSearch(patch);
  };
  const requestSelection = async (patch: Partial<BookingLinksState>) => {
    if (pageLeave.open()) return false;
    const result = pageLeave.requestLeave();
    if (!(typeof result === 'boolean' ? result : await result)) return false;
    commitSelection(patch);
    return true;
  };
  // Route history bypasses the UI setters. Dispose event/schedule editors,
  // but retain booking-page drafts so same-view history cannot lose edits.
  createEffect(
    on(
      [selectedOwnerId, () => search.tab],
      (selection, previous) => {
        if (
          previous &&
          (selection[0] !== previous[0] || selection[1] !== previous[1])
        )
          discardEditors();
      },
      { defer: true }
    )
  );
  const selectTab = (value: string) => {
    if (isSaving()) return;
    const next = TABS.find((item) => item.value === value);
    if (!next || next.value === search.tab) return;
    fireAndForget(requestSelection({ tab: next.value }), 'scheduling');
  };
  const selectOwner = (id: string) => {
    if (
      id === selectedOwnerId() ||
      isSaving() ||
      !scopes().some((scope) => scope.id === id)
    )
      return;
    fireAndForget(requestSelection({ owner: id }), 'scheduling');
  };
  const create = async (opener: HTMLElement) => {
    const current = owner();
    if (!current) return;
    if (search.tab === 'availability') {
      current.createSchedule(opener);
      return;
    }
    if (search.tab !== 'links' && !(await requestSelection({ tab: 'links' })))
      return;
    if (owner() !== current) return;
    await current.action(() => current.createEvent(opener));
  };
  const createWithAgent = async () => {
    const current = owner();
    if (
      !current?.scope().canEdit ||
      !current.source.profile() ||
      current.source.saving() ||
      startingAgent()
    )
      return;
    setStartingAgent(true);
    try {
      const allowed = pageLeave.requestLeave();
      if (!(typeof allowed === 'boolean' ? allowed : await allowed)) return;
      if (
        owner() !== current ||
        !current.scope().canEdit ||
        !current.source.profile() ||
        current.source.saving()
      )
        return;
      await current.action(() =>
        capabilities.createBookingLinkWithAgent(current.scope())
      );
    } finally {
      setStartingAgent(false);
    }
  };
  return (
    <ViewShell.Root
      asidePreferenceKey="booking-links"
      aside={isTouchDevice() ? false : undefined}
      resizable={!isTouchDevice()}
      main={{ preferredWidth: 720 }}
    >
      <BookingPageLeaveDialog
        open={pageLeave.open()}
        pending={pageLeave.busy()}
        canSave={dirtyOwners().every(
          (current) => current.scope().canEdit && !!current.source.profile()
        )}
        error={pageLeave.error()}
        onKeepEditing={pageLeave.keepEditing}
        onDiscard={pageLeave.discard}
        onSave={() => fireAndForget(pageLeave.save(), 'scheduling')}
      />
      <ViewShell.Aside>
        <ViewSidebar.Root aria-label="Scheduling navigation">
          <ViewSidebar.Header>
            <div class="flex min-w-0 items-center gap-1">
              <ViewSidebar.CloseButton />
              <ViewSidebar.Title>Scheduling</ViewSidebar.Title>
            </div>
          </ViewSidebar.Header>
          <ViewSidebar.Content>
            <ViewSidebar.Nav
              aria-label="Booking calendar owner"
              class="max-h-[calc(4*var(--sidebar-row-height)+3*var(--sidebar-row-gap))] overflow-y-auto overscroll-none touch:max-h-[calc(11rem+3*var(--sidebar-row-gap))]"
            >
              <For each={scopes()}>
                {(scope) => (
                  <ViewSidebar.Item
                    active={selectedOwnerId() === scope.id}
                    aria-current={
                      selectedOwnerId() === scope.id ? 'true' : undefined
                    }
                    title={scope.teamId ? scope.name : 'Personal'}
                    disabled={isSaving()}
                    {...pressHandlers(() => selectOwner(scope.id))}
                  >
                    <ViewSidebar.Icon>
                      <Show
                        when={selectedOwnerId() === scope.id}
                        fallback={
                          <Show
                            when={scope.teamId}
                            fallback={<UserIcon class="size-4" />}
                          >
                            <UsersIcon class="size-4" />
                          </Show>
                        }
                      >
                        <CheckIcon class="size-4 text-accent" />
                      </Show>
                    </ViewSidebar.Icon>
                    <span class="truncate">
                      {scope.teamId ? scope.name : 'Personal'}
                    </span>
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
            <ViewSidebar.Nav aria-label="Booking tabs">
              <For each={TABS}>
                {(item) => (
                  <ViewSidebar.Item
                    active={search.tab === item.value}
                    disabled={isSaving()}
                    onClick={() => selectTab(item.value)}
                  >
                    <ViewSidebar.Icon>
                      <item.icon />
                    </ViewSidebar.Icon>
                    {item.label}
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </ViewShell.Aside>
      <ViewShell.Main class="touch:pt-[calc(var(--safe-top,0px)+3.75rem)] touch:pb-(--mobile-content-inset-bottom)">
        <Show when={isTouchDevice()}>
          <SchedulingMobileHeader
            tabs={TABS}
            tab={search.tab}
            scopes={scopes()}
            ownerId={selectedOwnerId()}
            disabled={isSaving()}
            editorTitle={
              editingSchedule()
                ? owner()
                    ?.source.profile()
                    ?.schedules.some(
                      (schedule) => schedule.id === owner()?.schedule()?.id
                    )
                  ? 'Edit schedule'
                  : 'Create schedule'
                : undefined
            }
            createLabel={
              owner()?.scope().canEdit &&
              (search.tab === 'links' || search.tab === 'availability')
                ? search.tab === 'links'
                  ? 'New booking link'
                  : 'New schedule'
                : undefined
            }
            createDisabled={
              isSaving() || startingAgent() || !owner()?.source.profile()
            }
            createAgentAction={
              <Show when={search.tab === 'links' && owner()?.scope().canEdit}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  class="size-10 rounded-full"
                  label="Create with agent"
                  disabled={
                    isSaving() || startingAgent() || !owner()?.source.profile()
                  }
                  onClick={() => fireAndForget(createWithAgent(), 'scheduling')}
                >
                  <SparkleIcon class="size-5" />
                </Button>
              </Show>
            }
            onTab={selectTab}
            onOwner={selectOwner}
            onBack={() => owner()?.closeScheduleEditor()}
            onCreate={(opener) => fireAndForget(create(opener), 'scheduling')}
          />
        </Show>
        <ViewShell.TopBar>
          <Show
            when={search.tab === 'availability'}
            fallback={
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <div class="flex min-w-0 items-center gap-1">
                  <h1 class="min-w-0 truncate pl-2 text-sm font-semibold">
                    {tab().label}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    label={`About ${tab().label.toLowerCase()}`}
                    tooltip={tab().description}
                  >
                    <InfoIcon class="size-4 text-ink-muted" />
                  </Button>
                </div>
                <Show when={owner()}>
                  {(current) => (
                    <div class="hidden min-w-0 sm:block">
                      <OwnerBadge scope={current().scope()} />
                    </div>
                  )}
                </Show>
              </div>
            }
          >
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <AvailabilityTopBar
                editing={editingSchedule()}
                creating={
                  !owner()
                    ?.source.profile()
                    ?.schedules.some(
                      (schedule) => schedule.id === owner()?.schedule()?.id
                    )
                }
                disabled={isSaving() || !owner()?.source.profile()}
                onBack={() => owner()?.closeScheduleEditor()}
              />
              <Show when={!editingSchedule() && owner()}>
                {(current) => (
                  <div class="hidden min-w-0 sm:block">
                    <OwnerBadge scope={current().scope()} />
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </ViewShell.TopBar>
        <Show
          when={
            search.tab === 'links' ||
            (search.tab === 'availability' && !editingSchedule())
          }
        >
          <ViewShell.Header class="touch:pt-0">
            <div class="flex min-w-0 flex-wrap items-center gap-3">
              <Show when={search.tab === 'links'}>
                <SearchBar
                  label="Search booking links"
                  placeholder="Search booking links…"
                  value={query()}
                  onValueChange={setQuery}
                  class="max-w-md flex-1"
                />
                <Show when={owner()?.scope().canEdit}>
                  <div class="ml-auto flex shrink-0 items-center gap-2 touch:hidden">
                    <Button
                      label="Create with agent"
                      tooltipDisabled
                      variant="outline"
                      size="md"
                      disabled={
                        !owner()?.source.profile() ||
                        owner()?.source.saving() ||
                        startingAgent()
                      }
                      onClick={() =>
                        fireAndForget(createWithAgent(), 'scheduling')
                      }
                    >
                      <SparkleIcon class="size-4" />
                      <span>Create with agent</span>
                    </Button>
                    <Button
                      label="New booking link"
                      tooltipDisabled
                      variant="strong"
                      size="md"
                      disabled={
                        !owner()?.source.profile() ||
                        owner()?.source.saving() ||
                        startingAgent()
                      }
                      onClick={(event) =>
                        fireAndForget(create(event.currentTarget), 'scheduling')
                      }
                    >
                      <PlusIcon class="size-4" />
                      <span>New</span>
                    </Button>
                  </div>
                </Show>
              </Show>
              <Show when={search.tab === 'availability'}>
                <SearchBar
                  label="Search schedules"
                  placeholder="Search schedules…"
                  value={availabilitySearch()}
                  onValueChange={setAvailabilitySearch}
                  class="max-w-md flex-1"
                />
                <Show when={owner()?.scope().canEdit}>
                  <div class="ml-auto shrink-0 touch:hidden">
                    <Button
                      label="New schedule"
                      tooltip="New schedule"
                      variant="strong"
                      size="md"
                      disabled={isSaving() || !owner()?.source.profile()}
                      onClick={(event) =>
                        fireAndForget(create(event.currentTarget), 'scheduling')
                      }
                    >
                      <PlusIcon class="size-4" />
                      <span>New</span>
                    </Button>
                  </div>
                </Show>
              </Show>
            </div>
          </ViewShell.Header>
        </Show>
        <ViewShell.Content
          class={cn('px-4', {
            'flex min-h-0 flex-col overflow-hidden':
              editingSchedule() || search.tab === 'page',
            'overflow-auto pb-8': !editingSchedule() && search.tab !== 'page',
            'pb-4': search.tab === 'page',
          })}
        >
          <For each={owners()}>
            {(current) => (
              <div
                class="min-w-0"
                classList={{
                  'flex min-h-0 flex-1 flex-col':
                    editingSchedule() || search.tab === 'page',
                }}
                hidden={owner() !== current}
              >
                <Show when={current.source.loading()}>
                  <p role="status" class="py-8 text-sm text-ink-muted">
                    Loading {tab().label.toLowerCase()}…
                  </p>
                </Show>
                <Show when={current.error() || current.source.error()}>
                  <div
                    role="alert"
                    class="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-failure-bg p-4 text-sm text-failure"
                  >
                    <p class="min-w-0 flex-1">
                      {current.error() || current.source.error()}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={current.source.reload}
                    >
                      Try again
                    </Button>
                  </div>
                </Show>
                <Show when={!current.scope().canEdit}>
                  <p class="mb-4 rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">
                    Only team owners and admins can edit {current.scope().name}{' '}
                    scheduling.
                  </p>
                </Show>
                <Show when={search.tab === 'links' && owner() === current}>
                  <OwnerSettingsSection
                    kind="links"
                    owner={current}
                    search={query()}
                  />
                </Show>
                <Show when={search.tab === 'availability'}>
                  <OwnerSettingsSection
                    kind="availability"
                    owner={current}
                    search={availabilitySearch()}
                    scheduleTopBarOwned
                  />
                </Show>
                <Show when={search.tab === 'bookings' && owner() === current}>
                  <OwnerSettingsSection
                    kind="bookings"
                    owner={current}
                    search={bookingsSearch()}
                    onSearchChange={setBookingsSearch}
                    dateRange={
                      <BookingsDateRange
                        inline={isTouchDevice()}
                        from={from()}
                        to={to()}
                        onChange={(start, end) =>
                          batch(() => {
                            setFrom(start);
                            setTo(end);
                          })
                        }
                      />
                    }
                  />
                </Show>
                <Show when={search.tab === 'insights' && owner() === current}>
                  <OwnerSettingsSection kind="insights" owner={current} />
                </Show>
                <Show when={search.tab === 'page' && owner() === current}>
                  <OwnerSettingsSection kind="page" owner={current} />
                </Show>
              </div>
            )}
          </For>
        </ViewShell.Content>
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
