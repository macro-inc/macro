import { SettingsButton as Button } from '@app/features/settings/primitives';
import Copy from '@phosphor/copy.svg';
import { Match, Show, Switch } from 'solid-js';
import { AvailabilityPanel } from '../components/availability-panel';
import { BookingsPanel } from '../components/bookings-panel';
import { EventEditor } from '../components/event-editor';
import { EventTypesPanel } from '../components/event-types-panel';
import { Field, TextArea, TextInput } from '../components/fields';
import { OwnerBadge } from '../components/owner-badge';
import { ScheduleEditor } from '../components/schedule-editor';
import { useScheduling } from '../context/scheduling-context';
import type { SchedulingOwner } from '../primitives/create-scheduling-owner';
import { InsightsView } from './insights-view';

export function OwnerSettingsSection(props: {
  kind: 'links' | 'availability' | 'page' | 'bookings' | 'insights';
  owner: SchedulingOwner;
  search?: string;
}) {
  const capabilities = useScheduling();
  const owner = props.owner;
  const {
    scope,
    source,
    event,
    schedule,
    profileDraft,
    setProfileDraft,
    save,
    action,
    busyBooking,
    bookingAction,
    closeEventEditor,
    closeScheduleEditor,
    duplicate,
  } = owner;
  return (
    <Show when={source.profile()}>
      {(p) => (
        <Switch>
          <Match when={props.kind === 'links'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <Show when={event()}>
                <div class="mb-4">
                  <OwnerBadge scope={scope()} />
                </div>
              </Show>
              <Show
                when={!event()}
                fallback={
                  <Show when={event()} keyed>
                    {(value) => (
                      <EventEditor
                        event={value}
                        events={p().eventTypes}
                        schedules={p().schedules}
                        members={capabilities.members()}
                        team={!!scope().teamId}
                        saving={source.saving()}
                        onCancel={closeEventEditor}
                        onSave={async (next) => {
                          const exists = p().eventTypes.some(
                            (e) => e.id === next.id
                          );
                          await save({
                            ...p(),
                            eventTypes: exists
                              ? p().eventTypes.map((e) =>
                                  e.id === next.id ? next : e
                                )
                              : [...p().eventTypes, next],
                          });
                          if (event()?.id === next.id) closeEventEditor();
                        }}
                      />
                    )}
                  </Show>
                }
              >
                <EventTypesPanel
                  owner={scope()}
                  search={props.search ?? ''}
                  events={p().eventTypes}
                  canEdit={scope().canEdit}
                  saving={source.saving()}
                  onEdit={owner.editEvent}
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
            </div>
          </Match>
          <Match when={props.kind === 'availability'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <Show when={schedule()}>
                <div class="mb-4">
                  <OwnerBadge scope={scope()} />
                </div>
              </Show>
              <Show
                when={!schedule()}
                fallback={
                  <Show when={schedule()} keyed>
                    {(value) => (
                      <ScheduleEditor
                        schedule={value}
                        saving={source.saving()}
                        onCancel={closeScheduleEditor}
                        onSave={async (next) => {
                          const exists = p().schedules.some(
                            (s) => s.id === next.id
                          );
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
                          if (schedule()?.id === next.id) closeScheduleEditor();
                        }}
                      />
                    )}
                  </Show>
                }
              >
                <AvailabilityPanel
                  owner={scope()}
                  profile={p()}
                  canEdit={scope().canEdit}
                  saving={source.saving()}
                  onEdit={owner.editSchedule}
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
            </div>
          </Match>
          <Match when={props.kind === 'page'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <OwnerBadge scope={scope()} />
                <div class="flex items-center gap-3">
                  <Show when={p().revision > 0}>
                    <a
                      class="text-sm text-ink-muted underline underline-offset-4"
                      href={capabilities.link(p())}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Preview page
                    </a>
                  </Show>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!p().revision}
                    onClick={() =>
                      void action(() => capabilities.copyLink(p()))
                    }
                  >
                    <Copy class="size-4" />
                    Copy page link
                  </Button>
                </div>
              </div>
              <div class="flex flex-col gap-4">
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
                <aside class="rounded-xl border border-edge-muted p-6">
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
            </div>
          </Match>
          <Match when={props.kind === 'bookings'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <div class="mb-4">
                <OwnerBadge scope={scope()} />
              </div>
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
            </div>
          </Match>
          <Match when={props.kind === 'insights'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <div class="mb-4">
                <OwnerBadge scope={scope()} />
              </div>
              <Show when={scope().id} keyed>
                {(_scopeId) => (
                  <InsightsView
                    source={source}
                    events={p().eventTypes}
                    members={capabilities.members()}
                    timeZone={
                      p().schedules.find((s) => s.id === p().defaultScheduleId)
                        ?.timeZone ??
                      p().schedules[0]?.timeZone ??
                      Intl.DateTimeFormat().resolvedOptions().timeZone
                    }
                  />
                )}
              </Show>
            </div>
          </Match>
        </Switch>
      )}
    </Show>
  );
}
