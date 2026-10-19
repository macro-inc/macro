import { fireAndForget } from '@core/util/fireAndForget';
import Copy from '@phosphor/copy.svg';
import { CopyButton } from '@ui';
import {
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { AvailabilityPanel } from '../components/availability-panel';
import { BookingPageEditor } from '../components/booking-page-editor';
import { EventTypesPanel } from '../components/event-types-panel';
import { useScheduling } from '../context/scheduling-context';
import type { SchedulingOwner } from '../primitives/create-scheduling-owner';
import { BookingsView } from './bookings-view';
import { EventDetailsDialog } from './event-details-view';
import { EventEditor } from './event-editor-view';
import { InsightsView } from './insights-view';
import { ScheduleEditor } from './schedule-editor-view';

export function OwnerSettingsSection(props: {
  kind: 'links' | 'availability' | 'page' | 'bookings' | 'insights';
  owner: SchedulingOwner;
  search?: string;
  onSearchChange?: (value: string) => void;
  dateRange?: JSX.Element;
  scheduleTopBarOwned?: boolean;
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
  const [details, setDetails] = createSignal<{
    id: string;
    opener?: HTMLElement;
  }>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  async function copyPageLink() {
    const profile = source.profile();
    if (!profile?.revision) return false;
    let copied = false;
    await action(async () => {
      await capabilities.copyLink(profile);
      copied = true;
    });
    return copied;
  }
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
              <Show when={event()} keyed>
                {(value) => (
                  <EventEditor
                    event={value}
                    events={p().eventTypes}
                    schedules={owner.eventSchedules()}
                    members={capabilities.members()}
                    team={!!scope().teamId}
                    defaultHosts={[capabilities.userId()]}
                    saving={source.saving()}
                    createActive={owner.createActive()}
                    dialogTitle={
                      p().eventTypes.some((item) => item.id === value.id)
                        ? 'Edit booking link'
                        : `New ${scope().teamId ? 'team' : 'personal'} booking link`
                    }
                    link={(slug) => capabilities.link(p(), slug)}
                    onCopyLink={(slug) => capabilities.copyLink(p(), slug)}
                    onCancel={closeEventEditor}
                    onSave={owner.saveEvent}
                  />
                )}
              </Show>
              <Show when={details()} keyed>
                {(selection) => (
                  <Show
                    when={p().eventTypes.find(
                      (item) => item.id === selection.id
                    )}
                  >
                    {(value) => (
                      <EventDetailsDialog
                        event={value()}
                        link={capabilities.link(p(), value().slug)}
                        schedule={p().schedules.find(
                          (item) => item.id === value().scheduleId
                        )}
                        members={capabilities.members()}
                        team={!!scope().teamId}
                        saving={source.saving()}
                        opener={selection.opener}
                        onCopyLink={() =>
                          capabilities.copyLink(p(), value().slug)
                        }
                        onClose={() => setDetails(undefined)}
                        onEdit={
                          scope().canEdit
                            ? (next, opener) => {
                                if (
                                  disposed ||
                                  !scope().canEdit ||
                                  source.saving()
                                )
                                  return;
                                const saved = source
                                  .profile()
                                  ?.eventTypes.find(
                                    (item) => item.id === next.id
                                  );
                                if (saved) owner.editEvent(saved, opener);
                              }
                            : undefined
                        }
                      />
                    )}
                  </Show>
                )}
              </Show>
              <EventTypesPanel
                owner={scope()}
                search={props.search ?? ''}
                events={p().eventTypes}
                canEdit={scope().canEdit}
                saving={source.saving()}
                onView={(item, opener) => setDetails({ id: item.id, opener })}
                onEdit={owner.editEvent}
                onDuplicate={duplicate}
                link={(item) => capabilities.link(p(), item.slug)}
                onCopy={(item) =>
                  fireAndForget(
                    action(() => capabilities.copyLink(p(), item.slug)),
                    'scheduling'
                  )
                }
                onToggle={(item, enabled) =>
                  fireAndForget(
                    action(() =>
                      save({
                        ...p(),
                        eventTypes: p().eventTypes.map((e) =>
                          e.id === item.id ? { ...e, enabled } : e
                        ),
                      })
                    ),
                    'scheduling'
                  )
                }
                onDelete={(item) =>
                  fireAndForget(
                    action(() =>
                      save({
                        ...p(),
                        eventTypes: p().eventTypes.filter(
                          (e) => e.id !== item.id
                        ),
                      })
                    ),
                    'scheduling'
                  )
                }
              />
            </div>
          </Match>
          <Match when={props.kind === 'availability'}>
            <div
              class="flex min-h-0 min-w-0 flex-1 flex-col"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <Show when={schedule()} keyed>
                {(value) => (
                  <ScheduleEditor
                    schedule={value}
                    topBarOwned={props.scheduleTopBarOwned}
                    creating={
                      !p().schedules.some(
                        (schedule) => schedule.id === value.id
                      )
                    }
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
              {/* Keep card openers mounted for focus restoration after editing. */}
              <div hidden={!!schedule()}>
                <AvailabilityPanel
                  profile={p()}
                  search={props.search}
                  canEdit={scope().canEdit}
                  saving={source.saving()}
                  onEdit={owner.editSchedule}
                  onDefault={(s) =>
                    fireAndForget(
                      action(() => save({ ...p(), defaultScheduleId: s.id })),
                      'scheduling'
                    )
                  }
                  onDelete={(s) =>
                    fireAndForget(
                      action(async () => {
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
                      }),
                      'scheduling'
                    )
                  }
                />
              </div>
            </div>
          </Match>
          <Match when={props.kind === 'page'}>
            <div
              class="flex min-h-0 min-w-0 flex-1 flex-col"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <div class="mb-4 flex shrink-0 flex-wrap items-center justify-end gap-3">
                <CopyButton
                  variant="outline"
                  size="md"
                  label="Copy link"
                  tooltip={
                    p().revision
                      ? undefined
                      : 'Save your booking page before sharing'
                  }
                  disabled={!p().revision}
                  onClick={copyPageLink}
                >
                  <Copy aria-hidden="true" class="size-4" />
                  Copy link
                </CopyButton>
              </div>
              <BookingPageEditor
                profile={{
                  id: p().id,
                  name: profileDraft()?.name ?? p().name,
                  description: profileDraft()?.description ?? p().description,
                  eventTypes: p().eventTypes.filter((event) => event.enabled),
                }}
                canEdit={scope().canEdit}
                saving={source.saving()}
                hasChanges={owner.hasProfileChanges()}
                onName={(name) =>
                  setProfileDraft({
                    name,
                    description: profileDraft()?.description ?? p().description,
                  })
                }
                onDescription={(description) =>
                  setProfileDraft({
                    name: profileDraft()?.name ?? p().name,
                    description,
                  })
                }
                onRevert={owner.revertProfile}
                onSave={() =>
                  fireAndForget(action(owner.saveProfile), 'scheduling')
                }
              />
            </div>
          </Match>
          <Match when={props.kind === 'bookings'}>
            <div
              class="min-w-0"
              role="group"
              aria-label={`${scope().name} ${props.kind === 'page' ? 'booking page' : props.kind}`}
            >
              <BookingsView
                search={props.search}
                onSearchChange={props.onSearchChange}
                dateRange={props.dateRange}
                loading={source.loading()}
                error={owner.error() || source.error()}
                bookings={source.bookings()}
                events={p().eventTypes}
                members={capabilities.members()}
                currentUserId={capabilities.userId()}
                canManageBookings={scope().canManageBookings}
                busyId={busyBooking()}
                onApprove={(id) =>
                  fireAndForget(
                    bookingAction(id, () => source.approve(id)),
                    'scheduling'
                  )
                }
                onCancel={(id) =>
                  fireAndForget(
                    bookingAction(id, () => source.cancel(id)),
                    'scheduling'
                  )
                }
                onManage={(id) =>
                  fireAndForget(
                    bookingAction(id, () => capabilities.manageBooking(id)),
                    'scheduling'
                  )
                }
                onAttendance={(id, attendance) =>
                  fireAndForget(
                    bookingAction(id, () =>
                      source.setAttendance(id, attendance)
                    ),
                    'scheduling'
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
