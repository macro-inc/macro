import { type Accessor, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { SchedulingCapabilities } from '../context/scheduling-context';
import {
  type AvailabilitySchedule,
  type EventType,
  newEventType,
  newSchedule,
  type SchedulingProfile,
  type SchedulingScope,
} from '../core/types';

export function createSchedulingOwner(
  capabilities: Pick<SchedulingCapabilities, 'createSource' | 'userId'>,
  scope: Accessor<SchedulingScope>,
  range: Accessor<{ from: string; to: string }>
) {
  const source = capabilities.createSource(scope, range);
  const [event, setEvent] = createSignal<EventType>();
  const [schedule, setSchedule] = createSignal<AvailabilitySchedule>();
  const [error, setError] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [busyBooking, setBusyBooking] = createSignal('');
  const [profileDraft, setProfileDraft] = createSignal<{
    name: string;
    description: string;
  }>();
  let eventOpener: HTMLElement | undefined;
  let scheduleOpener: HTMLElement | undefined;
  const focusedElement = () =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const restoreFocus = (opener?: HTMLElement) =>
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  const editEvent = (next: EventType) => {
    eventOpener = focusedElement();
    setEvent(next);
  };
  const editSchedule = (next: AvailabilitySchedule) => {
    scheduleOpener = focusedElement();
    setSchedule(next);
  };
  const closeEventEditor = () => {
    setEvent(undefined);
    restoreFocus(eventOpener);
  };
  const closeScheduleEditor = () => {
    setSchedule(undefined);
    restoreFocus(scheduleOpener);
  };
  const save = async (next: SchedulingProfile) => {
    if (!scope().canEdit)
      throw new Error('Only owners and admins can edit team scheduling.');
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
  const createEvent = async (opener?: HTMLElement) => {
    if (!scope().canEdit || creating() || source.saving()) return;
    let profile = source.profile();
    if (!profile) return;
    eventOpener = opener ?? focusedElement();
    setCreating(true);
    try {
      if (!profile.schedules.length) {
        const next = newSchedule(
          Intl.DateTimeFormat().resolvedOptions().timeZone
        );
        await save({
          ...profile,
          schedules: [next],
          defaultScheduleId: next.id,
        });
        profile = source.profile();
        if (!profile) return;
      }
      setEvent(
        newEventType(
          profile.defaultScheduleId ?? profile.schedules[0].id,
          [capabilities.userId()],
          !!scope().teamId
        )
      );
    } finally {
      setCreating(false);
    }
  };
  const createSchedule = (opener?: HTMLElement) => {
    if (scope().canEdit && !source.saving()) {
      editSchedule(
        newSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone)
      );
      scheduleOpener = opener ?? scheduleOpener;
    }
  };
  const duplicate = (item: EventType) => {
    const existing = source.profile()?.eventTypes ?? [];
    let slug = `${item.slug}-copy`;
    let suffix = 2;
    while (existing.some((e) => e.slug === slug))
      slug = `${item.slug}-copy-${suffix++}`;
    editEvent({
      ...structuredClone(unwrap(item)),
      id: crypto.randomUUID(),
      title: `${item.title} (copy)`,
      slug,
      enabled: false,
    });
  };
  return {
    scope,
    source,
    event,
    schedule,
    error,
    creating,
    busyBooking,
    profileDraft,
    setProfileDraft,
    save,
    action,
    bookingAction,
    editEvent,
    editSchedule,
    closeEventEditor,
    closeScheduleEditor,
    createEvent,
    createSchedule,
    duplicate,
  };
}
export type SchedulingOwner = ReturnType<typeof createSchedulingOwner>;
