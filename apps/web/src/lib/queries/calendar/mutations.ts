import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type CalendarDeletionScope,
  type CalendarRsvpScope,
  emailClient,
} from '@service-email/client';
import type { CalendarEvent as CalendarEventEntity } from '@service-email/generated/schemas/calendarEvent';
import type { CreateCalendarEventRequest } from '@service-email/generated/schemas/createCalendarEventRequest';
import type { UpdateCalendarEventRequest } from '@service-email/generated/schemas/updateCalendarEventRequest';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import { useMutation } from '@tanstack/solid-query';
import { calendarKeys, RSVP_MUTATION_KEY } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import {
  type CalendarOccurrencesData,
  invalidateCalendarOccurrences,
} from './occurrences';

export type {
  CreateCalendarEventRequest,
  UpdateCalendarEventRequest,
} from '@service-email/generated/schemas';

type CalendarMutationContext = { rollback: () => void };

/**
 * Optimistically rewrite every cached occurrence viewport (each visible
 * range is its own cache entry) and return a rollback that restores the
 * exact snapshots.
 */
async function patchOccurrenceCaches(
  update: (items: CalendarOccurrenceItem[]) => CalendarOccurrenceItem[]
): Promise<CalendarMutationContext> {
  await queryClient.cancelQueries({
    queryKey: calendarKeys.occurrences._def,
  });
  const previous = queryClient.getQueriesData<CalendarOccurrencesData>({
    queryKey: calendarKeys.occurrences._def,
  });
  patchOccurrenceQueries(update);
  return {
    rollback: () => {
      for (const [queryKey, data] of previous) {
        queryClient.setQueryData(queryKey, data);
      }
    },
  };
}

function patchEventItems(
  eventId: string,
  patch: (item: CalendarOccurrenceItem) => CalendarOccurrenceItem
) {
  return (items: CalendarOccurrenceItem[]) =>
    items.some((item) => item.event.id === eventId)
      ? items.map((item) => (item.event.id === eventId ? patch(item) : item))
      : items;
}

export interface RsvpCalendarEventArgs {
  eventId: string;
  response: Exclude<AttendeeResponseStatus, 'needs_action'>;
  /** How much of a recurring series to answer for; defaults to all of it. */
  scope?: CalendarRsvpScope;
  /** Original-start key of the occurrence a scoped response targets. */
  recurrenceId?: string;
  /** Cache key of the occurrence, for the optimistic update. */
  occurrenceKey?: string;
}

/**
 * Whether a cached occurrence is covered by a scoped response. An omitted
 * scope with a recurrenceId is occurrence-scoped, matching the API default.
 */
function answeredByRsvp(
  item: CalendarOccurrenceItem,
  args: RsvpCalendarEventArgs
): boolean {
  if (item.event.id !== args.eventId) return false;
  if (
    args.scope === 'this_event' ||
    (args.scope === undefined && args.recurrenceId !== undefined)
  ) {
    return (
      args.occurrenceKey !== undefined &&
      item.occurrence.occurrenceKey === args.occurrenceKey
    );
  }
  return true;
}

type RsvpCallbacks = MutationCallbacks<
  CalendarEventEntity,
  Error,
  RsvpCalendarEventArgs,
  RsvpMutationContext
>;

type RsvpMutationContext = CalendarMutationContext & {
  /** Drops this mutation's writer stamps once it has settled. */
  release: () => void;
};

let rsvpRevisionCounter = 0;
/**
 * Latest optimistic writer per (event, occurrence). Value equality cannot
 * tell overlapping same-response mutations apart, so rollback ownership is
 * tracked explicitly: an older mutation's failure must not revert an
 * occurrence a newer mutation has since answered.
 */
const rsvpLastWriter = new Map<string, number>();

const rsvpWriterKey = (eventId: string, occurrenceKey: string) =>
  JSON.stringify([eventId, occurrenceKey]);

function selfResponseOf(
  item: CalendarOccurrenceItem
): AttendeeResponseStatus | undefined {
  return item.event.attendees.find((attendee) => attendee.isSelf)
    ?.responseStatus;
}

function withSelfResponse(
  item: CalendarOccurrenceItem,
  response: AttendeeResponseStatus
): CalendarOccurrenceItem {
  return {
    ...item,
    event: {
      ...item.event,
      attendees: item.event.attendees.map((attendee) =>
        attendee.isSelf ? { ...attendee, responseStatus: response } : attendee
      ),
    },
  };
}

function patchOccurrenceQueries(
  update: (items: CalendarOccurrenceItem[]) => CalendarOccurrenceItem[]
) {
  queryClient.setQueriesData<CalendarOccurrencesData>(
    { queryKey: calendarKeys.occurrences._def },
    (old) => {
      if (!old) return old;
      const items = update(old.items);
      return items === old.items ? old : { ...old, items };
    }
  );
}

/** Previous self responses of the occurrences a scoped answer covers. */
function readAnsweredResponses(
  args: RsvpCalendarEventArgs
): Map<string, AttendeeResponseStatus> {
  const previous = new Map<string, AttendeeResponseStatus>();
  for (const [, data] of queryClient.getQueriesData<CalendarOccurrencesData>({
    queryKey: calendarKeys.occurrences._def,
  })) {
    for (const item of data?.items ?? []) {
      if (!answeredByRsvp(item, args)) continue;
      const key = item.occurrence.occurrenceKey;
      if (previous.has(key)) continue;
      const response = selfResponseOf(item);
      if (response !== undefined) previous.set(key, response);
    }
  }
  return previous;
}

/**
 * Sets the viewer's RSVP for one occurrence or the whole series. Google
 * records an occurrence-scoped response as an exception instance, so the
 * answer can differ per occurrence.
 *
 * The buttons stay enabled while the request is in flight (the round trip
 * writes through to the provider, which takes seconds), so overlapping
 * mutations are expected: the rollback restores only the occurrences this
 * mutation still owns per the writer stamps, and only the last mutation to
 * settle refetches — otherwise an earlier settle would clobber a later
 * mutation's optimistic state with stale server data.
 */
export function useRsvpCalendarEventMutation(callbacks?: RsvpCallbacks) {
  return useMutation(() => ({
    mutationKey: RSVP_MUTATION_KEY,
    mutationFn: async (args: RsvpCalendarEventArgs) =>
      await throwOnErr(() =>
        emailClient.rsvpCalendarEvent(args.eventId, {
          response: args.response,
          scope: args.scope,
          recurrenceId: args.recurrenceId,
        })
      ),
    ...withCallbacks<
      CalendarEventEntity,
      Error,
      RsvpCalendarEventArgs,
      RsvpMutationContext
    >(
      {
        onMutate: async (args) => {
          const revision = ++rsvpRevisionCounter;
          await queryClient.cancelQueries({
            queryKey: calendarKeys.occurrences._def,
          });
          const previous = readAnsweredResponses(args);
          for (const occurrenceKey of previous.keys()) {
            rsvpLastWriter.set(
              rsvpWriterKey(args.eventId, occurrenceKey),
              revision
            );
          }
          patchOccurrenceQueries((items) =>
            items.map((item) =>
              answeredByRsvp(item, args)
                ? withSelfResponse(item, args.response)
                : item
            )
          );
          return {
            rollback: () => {
              patchOccurrenceQueries((items) =>
                items.map((item) => {
                  if (!answeredByRsvp(item, args)) return item;
                  const occurrenceKey = item.occurrence.occurrenceKey;
                  if (
                    rsvpLastWriter.get(
                      rsvpWriterKey(args.eventId, occurrenceKey)
                    ) !== revision
                  ) {
                    return item;
                  }
                  const restored = previous.get(occurrenceKey);
                  if (restored === undefined) return item;
                  if (selfResponseOf(item) !== args.response) return item;
                  return withSelfResponse(item, restored);
                })
              );
            },
            release: () => {
              for (const occurrenceKey of previous.keys()) {
                const key = rsvpWriterKey(args.eventId, occurrenceKey);
                if (rsvpLastWriter.get(key) === revision) {
                  rsvpLastWriter.delete(key);
                }
              }
            },
          };
        },
        onError: (_error, _args, context) => context?.rollback(),
        onSettled: (_data, _error, args, context) => {
          context?.release();
          if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) > 1) {
            return;
          }
          invalidateCalendarEventPreviews(args.eventId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}

export interface DeleteCalendarEventArgs {
  eventId: string;
  /** Calendar whose copy of the event is deleted. Omit for the canonical copy. */
  calendarId?: string;
  /** How much of a recurring series to remove; defaults to all of it. */
  scope?: CalendarDeletionScope;
  /** Original-start key of the occurrence a scoped deletion targets. */
  recurrenceId?: string;
  /** Cache key of the occurrence, for the optimistic update. */
  occurrenceKey?: string;
}

function survivesDeletion(
  item: CalendarOccurrenceItem,
  args: DeleteCalendarEventArgs
): boolean {
  if (item.event.id !== args.eventId) return true;
  if (args.scope === 'this_event') {
    return item.occurrence.occurrenceKey !== args.occurrenceKey;
  }
  if (args.scope === 'this_and_following' && args.occurrenceKey !== undefined) {
    // Occurrence keys within one event share a format, so ordering is
    // lexicographic.
    return item.occurrence.occurrenceKey < args.occurrenceKey;
  }
  return false;
}

/** The entity fields the server re-projects from the copy that becomes canonical. */
function canonicalContentOf(
  copy: CalendarEventSourceContent
): Partial<CalendarOccurrenceItem['event']> {
  return {
    calendarId: copy.calendarId,
    title: copy.title,
    description: copy.description,
    location: copy.location,
    eventType: copy.eventType,
    reminders: copy.reminders,
    isReadOnly: copy.isReadOnly,
    transparency: copy.transparency,
    visibility: copy.visibility,
    creatorName: copy.creatorName,
    creatorEmail: copy.creatorEmail,
  };
}

/**
 * Cached items after an optimistic deletion. Deleting a whole event that is
 * one copy among several retires only that copy at the provider, so the
 * event stays under its remaining calendars with that copy dropped and, when
 * the copy was canonical, the entity re-projected from the next one.
 * Everything else removes the covered occurrences.
 */
function applyDeletion(
  items: CalendarOccurrenceItem[],
  args: DeleteCalendarEventArgs
): CalendarOccurrenceItem[] {
  if (!items.some((item) => item.event.id === args.eventId)) return items;
  return items.flatMap((item) => {
    if (item.event.id !== args.eventId) return [item];
    const sources = item.event.sources ?? [];
    const targetCalendarId = args.calendarId ?? sources[0]?.calendarId;
    const remaining = sources.filter(
      (copy) => copy.calendarId !== targetCalendarId
    );
    const [nextCanonical] = remaining;
    if (
      (args.scope ?? 'all') !== 'all' ||
      !nextCanonical ||
      remaining.length === sources.length
    ) {
      return survivesDeletion(item, args) ? [item] : [];
    }
    const removesCanonical = targetCalendarId === sources[0]?.calendarId;
    return [
      {
        ...item,
        event: {
          ...item.event,
          ...(removesCanonical ? canonicalContentOf(nextCanonical) : {}),
          sources: remaining,
        },
      },
    ];
  });
}

type DeleteCallbacks = MutationCallbacks<
  unknown,
  Error,
  DeleteCalendarEventArgs,
  CalendarMutationContext
>;

/** Deletes an event (a recurring event's entire series) at the provider. */
export function useDeleteCalendarEventMutation(callbacks?: DeleteCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: DeleteCalendarEventArgs) =>
      await throwOnErr(() =>
        emailClient.deleteCalendarEvent(args.eventId, {
          calendarId: args.calendarId,
          scope: args.scope,
          recurrenceId: args.recurrenceId,
        })
      ),
    ...withCallbacks<
      unknown,
      Error,
      DeleteCalendarEventArgs,
      CalendarMutationContext
    >(
      {
        onMutate: (args) =>
          patchOccurrenceCaches((items) => applyDeletion(items, args)),
        onError: (_error, _args, context) => context?.rollback(),
        onSettled: (_data, _error, args) => {
          invalidateCalendarEventPreviews(args.eventId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}

export interface UpdateCalendarEventArgs {
  eventId: string;
  /** Calendar whose copy of the event is patched. Omit for the canonical copy. */
  calendarId?: string;
  patch: Omit<UpdateCalendarEventRequest, 'calendarId'>;
}

type UpdateCallbacks = MutationCallbacks<
  CalendarEventEntity,
  Error,
  UpdateCalendarEventArgs,
  CalendarMutationContext
>;

/** The per-copy fields a patch rewrites on one copy of the event. */
function applyCopyPatch<
  T extends Pick<
    CalendarEventEntity,
    'title' | 'description' | 'location' | 'reminders'
  >,
>(copy: T, patch: UpdateCalendarEventArgs['patch']): T {
  const next = { ...copy };
  if (patch.title !== undefined && patch.title !== null) {
    next.title = patch.title;
  }
  if (patch.description !== undefined) {
    next.description = patch.description;
  }
  if (patch.location !== undefined) {
    next.location = patch.location;
  }
  if (patch.reminders !== undefined && patch.reminders !== null) {
    next.reminders = patch.reminders;
  }
  return next;
}

/**
 * Applies the field patch to a cached item. Per-copy fields land on the
 * addressed copy — the named calendar's, else the canonical (first) one —
 * and on the entity when that copy is canonical, mirroring how the server
 * records them. Times are only patched through to standalone occurrences —
 * recurring expansion is the provider's job, so recurring series keep their
 * cached instances until the refetch lands.
 */
function applyEventPatch(
  item: CalendarOccurrenceItem,
  args: UpdateCalendarEventArgs
): CalendarOccurrenceItem {
  const { patch } = args;
  const sources = item.event.sources ?? [];
  const targetCalendarId = args.calendarId ?? sources[0]?.calendarId;
  const patchesCanonical =
    sources.length === 0 || targetCalendarId === sources[0]?.calendarId;
  const event = patchesCanonical
    ? applyCopyPatch(item.event, patch)
    : { ...item.event };
  if (sources.length > 0) {
    event.sources = sources.map((copy) =>
      copy.calendarId === targetCalendarId ? applyCopyPatch(copy, patch) : copy
    );
  }
  const time = patch.time ?? undefined;
  const isStandalone =
    event.recurrenceLines.length === 0 &&
    (item.occurrence.recurrenceId === undefined ||
      item.occurrence.recurrenceId === null);
  let occurrence = item.occurrence;
  if (time) {
    event.time = time as EventTime;
    if (isStandalone) {
      occurrence = { ...occurrence, time: time as EventTime };
    }
  }
  return { ...item, event, occurrence };
}

/** Patches event fields; recurring events update the whole series. */
export function useUpdateCalendarEventMutation(callbacks?: UpdateCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: UpdateCalendarEventArgs) =>
      await throwOnErr(() =>
        emailClient.updateCalendarEvent(args.eventId, {
          ...args.patch,
          calendarId: args.calendarId,
        })
      ),
    ...withCallbacks<
      CalendarEventEntity,
      Error,
      UpdateCalendarEventArgs,
      CalendarMutationContext
    >(
      {
        onMutate: (args) =>
          patchOccurrenceCaches(
            patchEventItems(args.eventId, (item) => applyEventPatch(item, args))
          ),
        onError: (_error, _args, context) => context?.rollback(),
        onSettled: (_data, _error, args) => {
          invalidateCalendarEventPreviews(args.eventId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}

type CreateCallbacks = MutationCallbacks<
  CalendarEventEntity,
  Error,
  CreateCalendarEventRequest,
  unknown
>;

/**
 * Creates an event on the selected calendar, defaulting to the requester's
 * primary calendar when no `calendarId` is given. There is no optimistic
 * insert — the entity id is only known once the provider echo lands — so
 * the viewport refetches on settle.
 */
export function useCreateCalendarEventMutation(callbacks?: CreateCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: CreateCalendarEventRequest) =>
      await throwOnErr(() => emailClient.createCalendarEvent(args)),
    ...withCallbacks<CalendarEventEntity, Error, CreateCalendarEventRequest>(
      {
        onSettled: () => invalidateCalendarOccurrences(),
      },
      callbacks
    ),
  }));
}
