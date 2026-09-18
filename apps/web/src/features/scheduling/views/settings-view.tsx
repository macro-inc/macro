import Copy from '@phosphor/copy.svg';
import Plus from '@phosphor/plus.svg';
import Users from '@phosphor/users.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { AvailabilityPanel } from '../components/availability-panel';
import { BookingsPanel } from '../components/bookings-panel';
import { EventEditor } from '../components/event-editor';
import { EventTypesPanel } from '../components/event-types-panel';
import { Field, SelectInput, TextArea, TextInput } from '../components/fields';
import { ScheduleEditor } from '../components/schedule-editor';
import {
  SchedulingWorkspace,
  schedulingPages,
} from '../components/scheduling-workspace';
import { useScheduling } from '../context/scheduling-context';
import {
  type AvailabilitySchedule,
  type EventType,
  newEventType,
  newSchedule,
  type SchedulingProfile,
} from '../core/types';
import { InsightsView } from './insights-view';

export function SchedulingSettingsView() {
  const capabilities = useScheduling();
  const [scopeId, setScopeId] = createSignal(
    capabilities.scopes()[0]?.id ?? 'me'
  );
  const scope = () =>
    capabilities.scopes().find((s) => s.id === scopeId()) ??
    capabilities.scopes()[0];
  const source = capabilities.createSource(scope);
  const [page, setPage] = createSignal('Event types');
  const [event, setEvent] = createSignal<EventType>();
  const [schedule, setSchedule] = createSignal<AvailabilitySchedule>();
  const [error, setError] = createSignal('');
  const [busyBooking, setBusyBooking] = createSignal('');
  const [profileDraft, setProfileDraft] = createSignal<{
    name: string;
    description: string;
  }>();
  const profile = source.profile;
  const editing = () => !!event() || !!schedule();
  const pageInfo = () => schedulingPages.find((p) => p.name === page());
  const navigate = (name: string) => {
    setPage(name);
    setEvent(undefined);
    setSchedule(undefined);
    setError('');
  };
  const changeScope = (id: string) => {
    setScopeId(id);
    setEvent(undefined);
    setSchedule(undefined);
    setProfileDraft(undefined);
    setError('');
  };
  const save = async (next: SchedulingProfile) => {
    setError('');
    await source.save(next);
  };
  const action = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your changes.');
    }
  };
  const bookingAction = async (id: string, fn: () => Promise<void>) => {
    setBusyBooking(id);
    await action(fn);
    setBusyBooking('');
  };
  const createEvent = async () => {
    let p = profile();
    if (!p) return;
    if (!p.schedules.length) {
      const s = newSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone);
      await save({ ...p, schedules: [s], defaultScheduleId: s.id });
      p = profile();
      if (!p) return;
    }
    setEvent(
      newEventType(
        p.defaultScheduleId ?? p.schedules[0].id,
        [capabilities.userId()],
        !!scope().teamId
      )
    );
  };
  const duplicate = (item: EventType) => {
    const existing = profile()?.eventTypes ?? [];
    let slug = `${item.slug}-copy`;
    let suffix = 2;
    while (existing.some((e) => e.slug === slug))
      slug = `${item.slug}-copy-${suffix++}`;
    setEvent({
      ...structuredClone(unwrap(item)),
      id: crypto.randomUUID(),
      title: `${item.title} (copy)`,
      slug,
      enabled: false,
    });
  };
  return (
    <SchedulingWorkspace
      page={page()}
      onNavigate={navigate}
      editor={!!event()}
      title={!editing() ? pageInfo()?.name : undefined}
      description={pageInfo()?.description}
      publicLink={
        profile()?.revision ? capabilities.link(profile()!) : undefined
      }
      onCopy={() => {
        const p = profile();
        if (p) void action(() => capabilities.copyLink(p));
      }}
      onConnections={capabilities.openConnections}
      actions={
        <Show
          when={
            !editing() &&
            (page() === 'Event types' || page() === 'Availability')
          }
        >
          <Button
            variant="strong"
            disabled={!scope().canEdit || source.saving() || !profile()}
            onClick={() =>
              page() === 'Event types'
                ? void action(createEvent)
                : setSchedule(
                    newSchedule(
                      Intl.DateTimeFormat().resolvedOptions().timeZone
                    )
                  )
            }
          >
            <Plus class="size-4" />
            {page() === 'Event types' ? 'New event type' : 'New schedule'}
          </Button>
        </Show>
      }
    >
      <Show when={!editing() && page() !== 'Insights'}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="w-56">
            <SelectInput
              label="Calendar owner"
              value={scope().id}
              options={capabilities
                .scopes()
                .map((s) => ({ value: s.id, label: s.name }))}
              disabled={source.saving() || !!busyBooking()}
              onChange={changeScope}
            />
          </div>
          <Show when={page() === 'Event types' || page() === 'Booking page'}>
            <Button
              variant="outline"
              disabled={!profile()?.revision}
              onClick={() => {
                const p = profile();
                if (p) void action(() => capabilities.copyLink(p));
              }}
            >
              <Copy class="size-4" />
              Copy public link
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={!scope().canEdit}>
        <p class="rounded-lg border border-edge-muted px-4 py-3 text-sm text-ink-muted">
          Team members can view scheduling. Owners and admins manage links and
          availability.
        </p>
      </Show>
      <Show when={source.error()}>
        <div
          role="alert"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge-muted p-5"
        >
          <p class="text-sm">{source.error()}</p>
          <Button variant="outline" onClick={source.reload}>
            Try again
          </Button>
        </div>
      </Show>
      <Show when={source.loading()}>
        <p role="status" class="text-sm text-ink-muted">
          Loading scheduling…
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure">
          {error()}
        </p>
      </Show>
      <Show when={profile()}>
        {(p) => (
          <>
            <Show when={!editing()}>
              <Show when={page() === 'Event types'}>
                <EventTypesPanel
                  events={p().eventTypes}
                  canEdit={scope().canEdit}
                  saving={source.saving()}
                  onEdit={setEvent}
                  onDuplicate={duplicate}
                  link={(item) => capabilities.link(p(), item.slug)}
                  onCopy={(item) =>
                    void action(() => capabilities.copyLink(p(), item.slug))
                  }
                  onToggle={(item, enabled) =>
                    void action(() =>
                      save({
                        ...p(),
                        eventTypes: p().eventTypes.map((e) =>
                          e.id === item.id ? { ...e, enabled } : e
                        ),
                      })
                    )
                  }
                  onDelete={(item) =>
                    void action(() =>
                      save({
                        ...p(),
                        eventTypes: p().eventTypes.filter(
                          (e) => e.id !== item.id
                        ),
                      })
                    )
                  }
                />
              </Show>
              <Show when={page() === 'Availability'}>
                <AvailabilityPanel
                  profile={p()}
                  canEdit={scope().canEdit}
                  saving={source.saving()}
                  onEdit={setSchedule}
                  onDefault={(s) =>
                    void action(() => save({ ...p(), defaultScheduleId: s.id }))
                  }
                  onDelete={(s) =>
                    void action(async () => {
                      if (p().eventTypes.some((e) => e.scheduleId === s.id))
                        throw new Error(
                          'Move event types to another schedule first.'
                        );
                      const schedules = p().schedules.filter(
                        (x) => x.id !== s.id
                      );
                      await save({
                        ...p(),
                        schedules,
                        defaultScheduleId:
                          p().defaultScheduleId === s.id
                            ? (schedules[0]?.id ?? null)
                            : p().defaultScheduleId,
                      });
                    })
                  }
                />
              </Show>
              <Show when={page() === 'Bookings'}>
                <BookingsPanel
                  bookings={source.bookings()}
                  events={p().eventTypes}
                  members={capabilities.members()}
                  currentUserId={capabilities.userId()}
                  canEdit={scope().canEdit}
                  busyId={busyBooking()}
                  onApprove={(id) =>
                    void bookingAction(id, () => source.approve(id))
                  }
                  onCancel={(id) =>
                    void bookingAction(id, () => source.cancel(id))
                  }
                  onManage={(id) =>
                    void bookingAction(id, () => capabilities.manageBooking(id))
                  }
                  onAttendance={(id, attendance) =>
                    void bookingAction(id, () =>
                      source.setAttendance(id, attendance)
                    )
                  }
                />
              </Show>
              <Show when={page() === 'Insights'}>
                <Show when={scope().id} keyed>
                  {(_scopeId) => (
                    <InsightsView
                      scopeSelector={
                        <div class="w-48">
                          <SelectInput
                            label="Calendar owner"
                            value={scope().id}
                            options={capabilities
                              .scopes()
                              .map((s) => ({ value: s.id, label: s.name }))}
                            onChange={changeScope}
                          />
                        </div>
                      }
                      source={source}
                      events={p().eventTypes}
                      members={capabilities.members()}
                      timeZone={
                        p().schedules.find(
                          (s) => s.id === p().defaultScheduleId
                        )?.timeZone ??
                        p().schedules[0]?.timeZone ??
                        Intl.DateTimeFormat().resolvedOptions().timeZone
                      }
                    />
                  )}
                </Show>
              </Show>
              <Show when={page() === 'Teams'}>
                <div class="rounded-xl border border-edge-muted bg-panel">
                  <div class="flex items-center justify-between border-b border-edge-muted bg-surface-1 px-6 py-5">
                    <div>
                      <h2 class="font-semibold">Your teams</h2>
                      <p class="mt-1 text-sm text-ink-muted">
                        Team links use your existing Macro memberships.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={capabilities.openTeamSettings}
                    >
                      Manage teams
                    </Button>
                  </div>
                  <For
                    each={capabilities
                      .scopes()
                      .filter((s) => s.teamId && s.id === s.teamId)}
                    fallback={
                      <div class="flex flex-col items-center gap-3 p-12 text-center">
                        <Users class="size-8 text-ink-muted" />
                        <p class="font-medium">Bring your team together</p>
                        <p class="text-sm text-ink-muted">
                          Create or join a Macro team to offer collective and
                          round-robin meetings.
                        </p>
                        <Button
                          variant="strong"
                          onClick={capabilities.openTeamSettings}
                        >
                          Open team settings
                        </Button>
                      </div>
                    }
                  >
                    {(team) => (
                      <div class="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                        <div>
                          <h3 class="font-semibold">{team.name}</h3>
                          <p class="mt-1 text-sm text-ink-muted">
                            {team.canEdit ? 'Owner or admin' : 'Team member'} ·
                            Collective & round-robin scheduling
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            changeScope(team.id);
                            navigate('Event types');
                          }}
                        >
                          View event types
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={scope().teamId}>
                  <div class="overflow-hidden rounded-xl border border-edge-muted">
                    <div class="border-b border-edge-muted bg-surface-1 px-6 py-4">
                      <h2 class="font-semibold">Team members</h2>
                      <p class="mt-1 text-sm text-ink-muted">
                        Hosts need a connected calendar. Their personal working
                        hours are respected when configured.
                      </p>
                    </div>
                    <For each={capabilities.members()}>
                      {(member) => (
                        <div class="flex items-center gap-3 border-b border-edge-muted px-6 py-4 last:border-b-0">
                          <span class="flex size-9 items-center justify-center rounded-full bg-active text-sm font-medium">
                            {member.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <p class="text-sm font-medium">{member.name}</p>
                            <p class="text-xs text-ink-muted">{member.email}</p>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
              <Show when={page() === 'Booking page'}>
                <div class="grid gap-6 @min-[850px]:grid-cols-[1fr_320px]">
                  <div class="flex flex-col gap-6 rounded-xl border border-edge-muted p-6">
                    <Field label="Display name">
                      <TextInput
                        disabled={!scope().canEdit}
                        value={profileDraft()?.name ?? p().name}
                        onInput={(e) =>
                          setProfileDraft({
                            name: e.currentTarget.value,
                            description:
                              profileDraft()?.description ?? p().description,
                          })
                        }
                      />
                    </Field>
                    <Field label="Introduction">
                      <TextArea
                        disabled={!scope().canEdit}
                        value={profileDraft()?.description ?? p().description}
                        onInput={(e) =>
                          setProfileDraft({
                            name: profileDraft()?.name ?? p().name,
                            description: e.currentTarget.value,
                          })
                        }
                      />
                    </Field>
                    <Button
                      class="self-start"
                      variant="strong"
                      disabled={
                        !scope().canEdit || !profileDraft() || source.saving()
                      }
                      onClick={() =>
                        void action(async () => {
                          await save({ ...p(), ...profileDraft() });
                          setProfileDraft(undefined);
                        })
                      }
                    >
                      Save booking page
                    </Button>
                  </div>
                  <aside class="rounded-xl border border-edge-muted bg-surface-1 p-6">
                    <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Preview
                    </p>
                    <span class="mt-6 flex size-12 items-center justify-center rounded-full bg-active text-lg font-semibold">
                      {(profileDraft()?.name ?? p().name).slice(0, 1)}
                    </span>
                    <h2 class="mt-4 font-semibold">
                      {profileDraft()?.name ?? p().name}
                    </h2>
                    <p class="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                      {profileDraft()?.description ?? p().description}
                    </p>
                    <Show when={p().revision > 0}>
                      <a
                        class="mt-6 inline-block text-sm underline underline-offset-4"
                        href={capabilities.link(p())}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View public page ↗
                      </a>
                    </Show>
                  </aside>
                </div>
              </Show>
            </Show>
            <Show when={event()} keyed>
              {(value) => (
                <EventEditor
                  event={value}
                  events={p().eventTypes}
                  schedules={p().schedules}
                  members={capabilities.members()}
                  team={!!scope().teamId}
                  saving={source.saving()}
                  onCancel={() => setEvent(undefined)}
                  onSave={async (next) => {
                    const exists = p().eventTypes.some((e) => e.id === next.id);
                    await save({
                      ...p(),
                      eventTypes: exists
                        ? p().eventTypes.map((e) =>
                            e.id === next.id ? next : e
                          )
                        : [...p().eventTypes, next],
                    });
                    if (event()?.id === next.id) setEvent(undefined);
                  }}
                />
              )}
            </Show>
            <Show when={schedule()} keyed>
              {(value) => (
                <ScheduleEditor
                  schedule={value}
                  saving={source.saving()}
                  onCancel={() => setSchedule(undefined)}
                  onSave={async (next) => {
                    const exists = p().schedules.some((s) => s.id === next.id);
                    await save({
                      ...p(),
                      defaultScheduleId:
                        p().defaultScheduleId ??
                        p().schedules[0]?.id ??
                        next.id,
                      schedules: exists
                        ? p().schedules.map((s) =>
                            s.id === next.id ? next : s
                          )
                        : [...p().schedules, next],
                    });
                    if (schedule()?.id === next.id) setSchedule(undefined);
                  }}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </SchedulingWorkspace>
  );
}
