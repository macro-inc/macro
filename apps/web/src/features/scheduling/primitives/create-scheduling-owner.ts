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
  range: Accessor<{ from: string; to: string }>,
  loadBookings?: Accessor<boolean>
) {
  const source = capabilities.createSource(scope, range, loadBookings);
  const [event, setEvent] = createSignal<EventType>();
  const [createActive, setCreateActive] = createSignal(false);
  const [schedule, setSchedule] = createSignal<AvailabilitySchedule>();
  const [pendingSchedule, setPendingSchedule] =
    createSignal<AvailabilitySchedule>();
  const eventSchedules = () => {
    const schedules = source.profile()?.schedules ?? [];
    const pending = pendingSchedule();
    return pending && !schedules.some((item) => item.id === pending.id)
      ? [...schedules, pending]
      : schedules;
  };
  const [error, setError] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [busyBooking, setBusyBooking] = createSignal('');
  const [profileDraft, setProfileDraftValue] =
    createSignal<Pick<SchedulingProfile, 'name' | 'description'>>();
  const setProfileDraft = (
    draft: Pick<SchedulingProfile, 'name' | 'description'> | undefined
  ) => {
    const profile = source.profile();
    setProfileDraftValue(
      draft &&
        profile &&
        draft.name === profile.name &&
        draft.description === profile.description
        ? undefined
        : draft
    );
  };
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
  const editEvent = (next: EventType, opener = focusedElement()) => {
    eventOpener = opener;
    setCreateActive(false);
    setEvent(next);
  };
  const editSchedule = (
    next: AvailabilitySchedule,
    opener = focusedElement()
  ) => {
    scheduleOpener = opener;
    setSchedule(next);
  };
  const closeEventEditor = () => {
    setEvent(undefined);
    setCreateActive(false);
    setPendingSchedule(undefined);
    restoreFocus(eventOpener);
  };
  const closeScheduleEditor = () => {
    setSchedule(undefined);
    restoreFocus(scheduleOpener);
  };
  // Navigation discards drafts without restoring focus to an obsolete opener.
  const discardEditors = () => {
    setEvent(undefined);
    setCreateActive(false);
    setPendingSchedule(undefined);
    setSchedule(undefined);
    eventOpener = undefined;
    scheduleOpener = undefined;
  };
  const save = async (next: SchedulingProfile) => {
    if (!scope().canEdit)
      throw new Error('Only team members can edit team scheduling.');
    setError('');
    await source.save(next);
  };
  const hasProfileChanges = () => {
    const draft = profileDraft();
    const profile = source.profile();
    return (
      !!draft &&
      (!profile ||
        draft.name !== profile.name ||
        draft.description !== profile.description)
    );
  };
  const revertProfile = () => {
    if (source.saving()) return;
    setProfileDraft(undefined);
    setError('');
  };
  const saveProfile = async () => {
    if (!hasProfileChanges()) return;
    if (source.saving()) throw new Error('Your booking page is still saving.');
    const profile = source.profile();
    const draft = profileDraft();
    if (!profile || !draft)
      throw new Error('Your booking page is not available yet.');
    await save({ ...profile, ...draft });
    // Preserve any newer edits made while the save was in flight.
    if (profileDraft() === draft) setProfileDraft(undefined);
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
    const profile = source.profile();
    if (!profile) return;
    eventOpener = opener ?? focusedElement();
    setCreating(true);
    try {
      const pending = profile.schedules.length
        ? undefined
        : newSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setPendingSchedule(pending);
      const scheduleId =
        profile.defaultScheduleId ?? profile.schedules[0]?.id ?? pending?.id;
      if (!scheduleId)
        throw new Error(
          'Choose an availability schedule before creating a link.'
        );
      setCreateActive(true);
      setEvent(
        newEventType(scheduleId, [capabilities.userId()], !!scope().teamId)
      );
    } finally {
      setCreating(false);
    }
  };
  const createSchedule = (opener?: HTMLElement) => {
    if (scope().canEdit && !source.saving()) {
      editSchedule(
        newSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone),
        opener
      );
    }
  };
  const duplicate = (item: EventType, opener?: HTMLElement) => {
    const existing = source.profile()?.eventTypes ?? [];
    let slug = `${item.slug}-copy`;
    let suffix = 2;
    while (existing.some((e) => e.slug === slug))
      slug = `${item.slug}-copy-${suffix++}`;
    editEvent(
      {
        ...structuredClone(unwrap(item)),
        id: crypto.randomUUID(),
        title: `${item.title} (copy)`,
        slug,
        enabled: false,
      },
      opener
    );
  };
  const saveEvent = async (next: EventType) => {
    const profile = source.profile();
    if (!profile) throw new Error('Booking settings are not available yet.');
    const pending = pendingSchedule();
    const schedules = eventSchedules();
    await save({
      ...profile,
      schedules,
      defaultScheduleId:
        profile.defaultScheduleId ?? profile.schedules[0]?.id ?? pending?.id,
      eventTypes: profile.eventTypes.some((item) => item.id === next.id)
        ? profile.eventTypes.map((item) => (item.id === next.id ? next : item))
        : [...profile.eventTypes, next],
    });
    if (event()?.id === next.id) closeEventEditor();
  };
  return {
    scope,
    source,
    event,
    createActive,
    schedule,
    eventSchedules,
    saveEvent,
    error,
    creating,
    busyBooking,
    profileDraft,
    setProfileDraft,
    hasProfileChanges,
    revertProfile,
    saveProfile,
    save,
    action,
    bookingAction,
    editEvent,
    editSchedule,
    closeEventEditor,
    closeScheduleEditor,
    discardEditors,
    createEvent,
    createSchedule,
    duplicate,
  };
}
export type SchedulingOwner = ReturnType<typeof createSchedulingOwner>;
