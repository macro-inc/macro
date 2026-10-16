import {
  SettingsButton as Button,
  SettingsSheetContext,
} from '@app/features/settings/primitives';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Tabs } from '@kobalte/core/tabs';
import CaretDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import {
  createMemo,
  createSignal,
  For,
  mapArray,
  Show,
  useContext,
} from 'solid-js';
import { Field, TextInput } from '../components/fields';
import { OwnerBadge } from '../components/owner-badge';
import { useScheduling } from '../context/scheduling-context';
import { reportDate, shiftReportDate } from '../core/insights';
import {
  createSchedulingOwner,
  type SchedulingOwner,
} from '../primitives/create-scheduling-owner';
import { OwnerSettingsSection } from './owner-settings-section';

function CreateAction(props: {
  owners: SchedulingOwner[];
  kind: 'event' | 'schedule';
}) {
  let trigger: HTMLButtonElement | undefined;
  const label = () =>
    props.kind === 'event' ? 'New booking link' : 'New schedule';
  const editable = () => props.owners.filter((owner) => owner.scope().canEdit);
  const disabled = (owner: SchedulingOwner) =>
    !owner.source.profile() ||
    owner.source.saving() ||
    owner.creating() ||
    !!(props.kind === 'event' ? owner.event() : owner.schedule());
  const create = (owner: SchedulingOwner) => {
    if (props.kind === 'event')
      void owner.action(() => owner.createEvent(trigger));
    else owner.createSchedule(trigger);
  };
  return (
    <Show when={editable()[0]}>
      {(owner) => (
        <Button
          ref={trigger}
          variant="strong"
          size="md"
          disabled={disabled(owner())}
          onClick={() => create(owner())}
        >
          <Plus class="size-4" />
          {label()}
        </Button>
      )}
    </Show>
  );
}

export function SchedulingSettingsView() {
  const capabilities = useScheduling();
  const inSheet = useContext(SettingsSheetContext);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = reportDate(new Date(), browserZone);
  const [bookingFrom, setBookingFrom] = createSignal(
    shiftReportDate(today, -30)
  );
  const [bookingTo, setBookingTo] = createSignal(shiftReportDate(today, 30));
  const [search, setSearch] = createSignal('');
  const [selectedOwner, setSelectedOwner] = createSignal<string>();
  const [sectionTab, setSectionTab] = createSignal('links');
  const activeOwnerId = () =>
    selectedOwner() &&
    capabilities.scopes().some((s) => s.id === selectedOwner())
      ? selectedOwner()
      : capabilities.scopes()[0]?.id;
  // Key by ID so profile updates and refreshed team metadata keep drafts mounted.
  const owners = createMemo(
    mapArray(
      () => capabilities.scopes().map((scope) => scope.id),
      (id) => {
        const scope = () =>
          capabilities.scopes().find((item) => item.id === id)!;
        return createSchedulingOwner(capabilities, scope, () => ({
          from: new Date(`${bookingFrom()}T00:00:00`).toISOString(),
          to: new Date(
            `${shiftReportDate(bookingTo(), 1)}T00:00:00`
          ).toISOString(),
        }));
      }
    )
  );
  const activeOwners = () =>
    owners().filter((owner) => owner.scope().id === activeOwnerId());
  const matching = (owner: SchedulingOwner) =>
    owner.source
      .profile()
      ?.eventTypes.some((event) =>
        `${event.title} ${event.slug} ${owner.scope().name} ${owner.scope().teamId ? 'team' : 'personal'}`
          .toLowerCase()
          .includes(search().trim().toLowerCase())
      );
  const section = (kind: 'availability' | 'page' | 'bookings' | 'insights') => (
    <div class="flex flex-col gap-8">
      <For each={owners()}>
        {(owner) => (
          <div hidden={owner.scope().id !== activeOwnerId()}>
            <Show
              when={
                owner.scope().id === activeOwnerId() ||
                (kind === 'availability' && owner.schedule())
              }
            >
              <OwnerSettingsSection kind={kind} owner={owner} />
            </Show>
          </div>
        )}
      </For>
    </div>
  );
  return (
    <div
      data-settings-page
      data-drawer-scroll-body={inSheet ? true : undefined}
      class="@container/booking-settings h-full min-h-0 overflow-y-auto bg-panel text-ink select-children [overflow-anchor:none]"
    >
      <div
        class="@container mx-auto w-full max-w-[960px] px-8 @max-[600px]/booking-settings:px-4"
        classList={{
          'pt-8 pb-24 touch:pt-[calc(var(--mobile-content-inset-top,0px)+1rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+3rem)]':
            !inSheet,
          'pt-2 pb-[max(24px,var(--mobile-sheet-safe-padding))]': inSheet,
        }}
      >
        <header
          class="mb-5 flex flex-wrap items-center justify-between gap-3"
          classList={{ 'justify-end': inSheet }}
        >
          <Show when={!inSheet}>
            <h1 class="text-xl font-medium tracking-tight">Booking links</h1>
          </Show>
          <DropdownMenu>
            <DropdownMenu.Trigger
              class="flex max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink"
              aria-label="Booking link owner"
              data-settings-target="teams"
              aria-description={
                activeOwners()[0]?.scope().teamId
                  ? `Team: ${activeOwners()[0]?.scope().name}`
                  : 'Personal'
              }
            >
              <Show
                when={activeOwners()[0]?.scope().teamId}
                fallback={<User class="size-4 shrink-0 text-ink-muted" />}
              >
                <Users class="size-4 shrink-0 text-ink-muted" />
              </Show>
              <span class="min-w-0 break-words text-left">
                {activeOwners()[0]?.scope().teamId
                  ? activeOwners()[0]?.scope().name
                  : 'Personal'}
              </span>
              <Show when={activeOwners()[0]?.scope().teamId}>
                <span class="text-xs text-ink-muted">Team</span>
              </Show>
              <CaretDown class="size-3 shrink-0 text-ink-muted" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="menu-surface z-action-menu min-w-56 max-w-80 p-1 text-sm">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel class="px-2 py-1.5 text-xs text-ink-muted">
                    Manage booking links for
                  </DropdownMenu.GroupLabel>
                  <For each={owners()}>
                    {(owner) => (
                      <DropdownMenu.Item
                        class="flex items-center gap-2 rounded px-2 py-2 outline-none data-highlighted:bg-hover"
                        onSelect={() => {
                          setSelectedOwner(owner.scope().id);
                          setSearch('');
                        }}
                      >
                        <Show
                          when={owner.scope().teamId}
                          fallback={
                            <User class="size-4 shrink-0 text-ink-muted" />
                          }
                        >
                          <Users class="size-4 shrink-0 text-ink-muted" />
                        </Show>
                        <span class="min-w-0 flex-1 break-words">
                          {owner.scope().teamId
                            ? `Team · ${owner.scope().name}`
                            : 'Personal'}
                        </span>
                        <Show when={activeOwnerId() === owner.scope().id}>
                          <Check class="size-4" />
                        </Show>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>
                <DropdownMenu.Separator class="my-1 border-t border-edge-muted" />
                <DropdownMenu.Item
                  class="rounded px-2 py-2 text-ink-muted outline-none data-highlighted:bg-hover"
                  onSelect={capabilities.openTeamSettings}
                >
                  Manage teams
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </header>
        <Tabs value={sectionTab()} onChange={setSectionTab}>
          <Tabs.List
            aria-label="Booking link settings"
            class="flex gap-6 overflow-x-auto border-b border-edge-muted"
          >
            <For
              each={[
                { value: 'links', label: 'Links', target: 'booking-links' },
                {
                  value: 'availability',
                  label: 'Availability',
                  target: 'availability',
                },
                {
                  value: 'page',
                  label: 'Booking page',
                  target: 'booking-pages',
                },
                { value: 'bookings', label: 'Bookings', target: 'bookings' },
                { value: 'insights', label: 'Insights', target: 'insights' },
              ]}
            >
              {(tab) => (
                <Tabs.Trigger
                  value={tab.value}
                  data-settings-target={tab.target}
                  class="shrink-0 border-b-2 border-transparent pt-1 pb-3 text-sm text-ink-muted outline-none data-selected:border-ink data-selected:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {tab.label}
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
          <For each={activeOwners()}>
            {(owner) => (
              <>
                <Show when={owner.source.loading()}>
                  <p role="status" class="mt-4 text-sm text-ink-muted">
                    Loading {owner.scope().name} scheduling…
                  </p>
                </Show>
                <Show when={owner.source.error() || owner.error()}>
                  <div
                    role="alert"
                    class="flex flex-wrap items-center gap-3 rounded-xl border border-edge-muted p-4"
                  >
                    <OwnerBadge scope={owner.scope()} />
                    <p class="flex-1 text-sm text-failure">
                      {owner.error() || owner.source.error()}
                    </p>
                    <Show when={owner.source.error()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={owner.source.reload}
                      >
                        Try again
                      </Button>
                    </Show>
                  </div>
                </Show>
                <Show when={!owner.scope().canEdit}>
                  <p class="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    <OwnerBadge scope={owner.scope()} />
                    Only team members can edit these settings.
                  </p>
                </Show>
              </>
            )}
          </For>
          <Tabs.Content
            value="links"
            class="pt-5"
            forceMount={owners().some((owner) => !!owner.event())}
            hidden={sectionTab() !== 'links'}
          >
            <section aria-label="Booking links">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="min-w-0 max-w-64 flex-1">
                  <TextInput
                    type="search"
                    class="h-8"
                    aria-label="Search booking links"
                    placeholder="Search booking links…"
                    value={search()}
                    onInput={(event) => setSearch(event.currentTarget.value)}
                  />
                </div>
                <CreateAction owners={activeOwners()} kind="event" />
              </div>
              <For each={owners()}>
                {(owner) => (
                  <div hidden={owner.scope().id !== activeOwnerId()}>
                    <Show
                      when={
                        owner.event() ||
                        (owner.scope().id === activeOwnerId() &&
                          matching(owner))
                      }
                    >
                      <OwnerSettingsSection
                        kind="links"
                        owner={owner}
                        search={search()}
                      />
                    </Show>
                  </div>
                )}
              </For>
              <Show
                when={
                  !activeOwners().some(
                    (owner) => owner.event() || matching(owner)
                  ) && !activeOwners().some((owner) => owner.source.loading())
                }
              >
                <p class="py-6 text-center text-sm text-ink-muted">
                  {search()
                    ? 'No matching booking links.'
                    : 'Create your first booking link to let people book time with you.'}
                </p>
              </Show>
            </section>
          </Tabs.Content>
          <Tabs.Content
            value="availability"
            class="pt-5"
            forceMount={owners().some((owner) => !!owner.schedule())}
            hidden={sectionTab() !== 'availability'}
          >
            <section aria-label="Availability">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-ink-muted">
                  {activeOwners()[0]?.scope().teamId
                    ? 'Team hours overlap with each host’s personal availability.'
                    : 'Your working hours, including meetings you host for a team.'}
                </p>
                <CreateAction owners={activeOwners()} kind="schedule" />
              </div>
              {section('availability')}
            </section>
          </Tabs.Content>
          <Tabs.Content value="page" class="pt-5">
            <section aria-label="Booking page">{section('page')}</section>
          </Tabs.Content>
          <Tabs.Content value="bookings" class="pt-5">
            <section aria-label="Bookings" class="flex flex-col gap-5">
              <div class="flex flex-wrap items-end gap-4">
                <Field
                  label="From"
                  hint={`Dates in ${browserZone.replaceAll('_', ' ')}`}
                >
                  <TextInput
                    type="date"
                    value={bookingFrom()}
                    max={bookingTo()}
                    onChange={(event) => {
                      if (
                        event.currentTarget.value &&
                        event.currentTarget.value <= bookingTo()
                      )
                        setBookingFrom(event.currentTarget.value);
                    }}
                  />
                </Field>
                <Field label="Through">
                  <TextInput
                    type="date"
                    value={bookingTo()}
                    min={bookingFrom()}
                    onChange={(event) => {
                      if (
                        event.currentTarget.value &&
                        event.currentTarget.value >= bookingFrom()
                      )
                        setBookingTo(event.currentTarget.value);
                    }}
                  />
                </Field>
              </div>
              {section('bookings')}
            </section>
          </Tabs.Content>
          <Tabs.Content value="insights" class="pt-5">
            <section aria-label="Insights">{section('insights')}</section>
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  );
}
