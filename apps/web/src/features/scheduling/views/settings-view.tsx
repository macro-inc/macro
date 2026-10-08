import {
  SettingsButton as Button,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Plus from '@phosphor/plus.svg';
import { createMemo, createSignal, For, mapArray, Show } from 'solid-js';
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
    <Show when={editable().length > 0}>
      <Show
        when={editable().length > 1}
        fallback={
          <Button
            ref={trigger}
            variant="outline"
            size="sm"
            disabled={!editable()[0] || disabled(editable()[0])}
            onClick={() => create(editable()[0])}
          >
            <Plus class="size-4" />
            {label()}
          </Button>
        }
      >
        <DropdownMenu>
          <DropdownMenu.Trigger
            as={Button}
            ref={trigger}
            variant="outline"
            size="sm"
          >
            <Plus class="size-4" />
            {label()}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="z-action-menu min-w-48 rounded-xl border border-edge-muted bg-menu p-1 text-sm shadow-lg">
              <div class="px-3 py-2 text-xs text-ink-muted">Create for</div>
              <For each={editable()}>
                {(owner) => (
                  <DropdownMenu.Item
                    disabled={disabled(owner)}
                    class="rounded-lg px-3 py-2 outline-none data-highlighted:bg-hover data-disabled:opacity-40"
                    onSelect={() => create(owner)}
                  >
                    <OwnerBadge scope={owner.scope()} />
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </Show>
  );
}

export function SchedulingSettingsView() {
  const capabilities = useScheduling();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = reportDate(new Date(), browserZone);
  const [bookingFrom, setBookingFrom] = createSignal(
    shiftReportDate(today, -30)
  );
  const [bookingTo, setBookingTo] = createSignal(shiftReportDate(today, 30));
  const [search, setSearch] = createSignal('');
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
        {(owner) => <OwnerSettingsSection kind={kind} owner={owner} />}
      </For>
    </div>
  );
  return (
    <SettingsPage
      title="Booking links"
      description="Manage your booking links, availability, and scheduled meetings."
    >
      <For each={owners()}>
        {(owner) => (
          <>
            <Show when={owner.source.loading()}>
              <p role="status" class="text-sm text-ink-muted">
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
              <p class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <OwnerBadge scope={owner.scope()} />
                Only team owners and admins can edit these settings.
              </p>
            </Show>
          </>
        )}
      </For>
      <SettingsSection
        title="Booking links"
        description="Personal and team links, together in one place."
        actions={<CreateAction owners={owners()} kind="event" />}
      >
        <div class="max-w-sm">
          <TextInput
            type="search"
            aria-label="Search booking links"
            placeholder="Search booking links…"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <For each={owners()}>
          {(owner) => (
            <Show when={owner.event() || matching(owner)}>
              <OwnerSettingsSection
                kind="links"
                owner={owner}
                search={search()}
              />
            </Show>
          )}
        </For>
        <Show
          when={
            !owners().some((owner) => owner.event() || matching(owner)) &&
            !owners().some((owner) => owner.source.loading())
          }
        >
          <p class="py-6 text-center text-sm text-ink-muted">
            {search()
              ? 'No matching booking links.'
              : 'Create your first booking link to let people book time with you.'}
          </p>
        </Show>
      </SettingsSection>
      <SettingsSection
        title="Availability"
        description="Working hours and date overrides for your personal and team calendars."
        actions={<CreateAction owners={owners()} kind="schedule" />}
      >
        {section('availability')}
      </SettingsSection>
      <SettingsSection
        title="Booking pages"
        description="Customize and share your personal and team booking pages."
      >
        {section('page')}
      </SettingsSection>
      <SettingsSection
        title="Teams"
        description="Schedule together with your Macro team."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={capabilities.openTeamSettings}
          >
            Manage teams
          </Button>
        }
      >
        <SettingsCard>
          <For
            each={owners().filter((owner) => owner.scope().teamId)}
            fallback={
              <SettingsRow
                label="No team connected"
                description="Create or join a team to offer collective and round-robin meetings."
              />
            }
          >
            {(owner) => (
              <SettingsRow
                label={owner.scope().name}
                description={
                  owner.scope().canEdit
                    ? 'Owner or admin · Collective and round-robin scheduling'
                    : 'Team member'
                }
              />
            )}
          </For>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Bookings"
        description="Review and manage meetings booked through your links."
      >
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
      </SettingsSection>
      <SettingsSection
        title="Insights"
        description="See how your personal and team booking links are being used."
      >
        {section('insights')}
      </SettingsSection>
    </SettingsPage>
  );
}
