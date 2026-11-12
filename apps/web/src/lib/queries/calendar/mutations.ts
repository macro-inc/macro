import { analytics } from '@app/lib/analytics';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
import { type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CalendarEvent as CalendarEventEntity } from '@service-calendar/generated/schemas/calendarEvent';
import type { CalendarGuestInputBody } from '@service-calendar/generated/schemas/calendarGuestInputBody';
import { CalendarMutationErrorCode } from '@service-calendar/generated/schemas/calendarMutationErrorCode';
import type { CreateCalendarEventRequest } from '@service-calendar/generated/schemas/createCalendarEventRequest';
import type { UpdateCalendarEventRequest } from '@service-calendar/generated/schemas/updateCalendarEventRequest';
import {
  type CalendarDeletionScope,
  type CalendarInviteScope,
  type CalendarRsvpScope,
  type CalendarUpdateScope,
  emailClient,
} from '@service-email/client';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import { useMutation } from '@tanstack/solid-query';
import {
  beginCalendarUpdate,
  type CalendarUpdate,
  installCalendarUpdate,
  isCalendarEventUpdating,
  prepareCalendarUpdate,
  settleCalendarUpdate,
} from './event-updates';
import { answeringGraphqlCalendarHost } from './graphql/flag';
import {
  CalendarMutationError,
  committedEvent,
  executeGraphqlCreate,
  executeGraphqlDelete,
  executeGraphqlInviteGuests,
  executeGraphqlRsvp,
  executeGraphqlUpdate,
} from './graphql/mutations';
import {
  type CalendarInvitationsData,
  invalidateCalendarInvitations,
} from './invitations';
import { calendarKeys, RSVP_MUTATION_KEY } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import {
  type CalendarOccurrencesData,
  invalidateCalendarOccurrences,
} from './occurrences';

export type {
  CreateCalendarEventRequest,
  UpdateCalendarEventRequest,
} from '@service-calendar/generated/schemas';

type CalendarMutationContext = { rollback: () => void };

/**
 * Moves when a write starts patching the occurrence viewports. A refresh
 * from an earlier write drops its refetch once this has moved: the server
 * may not have the newer write yet, so the refetch could undo its optimistic
 * patch, and the newer write refreshes the viewports itself once it settles.
 */
let occurrenceWriteRevision = 0;

/**
 * Optimistically rewrite every cached occurrence viewport (each visible
 * range is its own cache entry) and return a rollback that restores the
 * exact snapshots.
 */
async function patchOccurrenceCaches(
  update: (items: CalendarOccurrenceItem[]) => CalendarOccurrenceItem[]
): Promise<CalendarMutationContext> {
  occurrenceWriteRevision += 1;
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

/** Refreshes settled writes without holding the mutation open during a delta sync. */
function refreshAfterWrite(eventId: string) {
  fireAndForget(invalidateCalendarInvitations(), 'calendar-mutations');
  invalidateCalendarEventPreviews(eventId);
  const revision = occurrenceWriteRevision;
  const refresh = invalidateCalendarOccurrences(
    () => revision === occurrenceWriteRevision
  );
  fireAndForget(refresh, 'calendar-mutations');
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
  respondingEmail?: string;
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
  CalendarEventEntity | undefined,
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
 * Latest optimistic writer per (event, occurrence, attendee). Value equality cannot
 * tell overlapping same-response mutations apart, so rollback ownership is
 * tracked explicitly: an older mutation's failure must not revert an
 * occurrence a newer mutation has since answered.
 */
const rsvpLastWriter = new Map<string, number>();

function respondingAttendee(
  item: CalendarOccurrenceItem,
  args: RsvpCalendarEventArgs
) {
  return item.event.attendees.find((attendee) =>
    args.respondingEmail
      ? attendee.email.toLowerCase() === args.respondingEmail.toLowerCase()
      : attendee.isSelf
  );
}

function rsvpWriterKey(
  item: CalendarOccurrenceItem,
  args: RsvpCalendarEventArgs
) {
  const attendee = respondingAttendee(item, args);
  return JSON.stringify([
    item.event.id,
    item.occurrence.occurrenceKey,
    attendee?.email.toLowerCase(),
  ]);
}

function withResponse(
  item: CalendarOccurrenceItem,
  args: RsvpCalendarEventArgs,
  response: AttendeeResponseStatus
): CalendarOccurrenceItem {
  const selected = respondingAttendee(item, args);
  if (!selected) return item;
  return {
    ...item,
    event: {
      ...item.event,
      attendees: item.event.attendees.map((attendee) =>
        attendee === selected
          ? { ...attendee, responseStatus: response }
          : attendee
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

/** RSVP updates share writer ownership across viewport and invitation projections. */
function patchRsvpQueries(
  update: (items: CalendarOccurrenceItem[]) => CalendarOccurrenceItem[]
) {
  patchOccurrenceQueries(update);
  queryClient.setQueriesData<CalendarInvitationsData>(
    { queryKey: calendarKeys.invitations._def },
    (old) => {
      if (!old) return old;
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(old).map(([id, item]) => {
          if (item.kind !== 'resolved') return [id, item];
          const current = { event: item.event, occurrence: item.occurrence };
          const [updated] = update([current]);
          if (updated === current) return [id, item];
          changed = true;
          return [
            id,
            { ...item, event: updated.event, occurrence: updated.occurrence },
          ];
        })
      );
      // Writing an unaffected thread would also clear its failed-refresh state.
      return changed ? next : undefined;
    }
  );
}

/** Previous self responses of the occurrences a scoped answer covers. */
function readAnsweredResponses(
  args: RsvpCalendarEventArgs
): Map<string, AttendeeResponseStatus> {
  const previous = new Map<string, AttendeeResponseStatus>();
  const occurrences = queryClient
    .getQueriesData<CalendarOccurrencesData>({
      queryKey: calendarKeys.occurrences._def,
    })
    .flatMap(([, data]) => data?.items ?? []);
  const invitations = queryClient
    .getQueriesData<CalendarInvitationsData>({
      queryKey: calendarKeys.invitations._def,
    })
    .flatMap(([, data]) => Object.values(data ?? {}))
    .filter((item) => item.kind === 'resolved');
  for (const item of [...occurrences, ...invitations]) {
    if (!answeredByRsvp(item, args)) continue;
    const key = rsvpWriterKey(item, args);
    const response = respondingAttendee(item, args)?.responseStatus;
    if (response !== undefined && !previous.has(key))
      previous.set(key, response);
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
    mutationFn: async (args: RsvpCalendarEventArgs) => {
      const host = answeringGraphqlCalendarHost();
      if (host) return committedEvent(await executeGraphqlRsvp(host, args));
      return await throwOnErr(() =>
        emailClient.rsvpCalendarEvent(args.eventId, {
          response: args.response,
          respondingEmail: args.respondingEmail,
          scope: args.scope,
          recurrenceId: args.recurrenceId,
        })
      );
    },
    ...withCallbacks<
      CalendarEventEntity | undefined,
      Error,
      RsvpCalendarEventArgs,
      RsvpMutationContext
    >(
      {
        onMutate: async (args) => {
          occurrenceWriteRevision += 1;
          const revision = ++rsvpRevisionCounter;
          await queryClient.cancelQueries({
            queryKey: calendarKeys.occurrences._def,
          });
          await queryClient.cancelQueries({
            queryKey: calendarKeys.invitations._def,
          });
          const previous = readAnsweredResponses(args);
          for (const key of previous.keys()) {
            rsvpLastWriter.set(key, revision);
          }
          patchRsvpQueries((items) =>
            items.map((item) =>
              answeredByRsvp(item, args)
                ? withResponse(item, args, args.response)
                : item
            )
          );
          return {
            rollback: () => {
              patchRsvpQueries((items) =>
                items.map((item) => {
                  if (!answeredByRsvp(item, args)) return item;
                  const key = rsvpWriterKey(item, args);
                  if (rsvpLastWriter.get(key) !== revision) {
                    return item;
                  }
                  const restored = previous.get(key);
                  if (restored === undefined) return item;
                  if (
                    respondingAttendee(item, args)?.responseStatus !==
                    args.response
                  )
                    return item;
                  return withResponse(item, args, restored);
                })
              );
            },
            release: () => {
              for (const key of previous.keys()) {
                if (rsvpLastWriter.get(key) === revision) {
                  rsvpLastWriter.delete(key);
                }
              }
            },
          };
        },
        onSuccess: (_data, args) => {
          analytics.track('calendar_event_rsvp', {
            response: args.response,
            scope: args.scope ?? (args.recurrenceId ? 'this_event' : 'all'),
          });
        },
        onError: (_error, _args, context) => context?.rollback(),
        onSettled: (_data, _error, args, context) => {
          context?.release();
          if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) > 1) {
            return;
          }
          fireAndForget(invalidateCalendarInvitations(), 'calendar-mutations');
          invalidateCalendarEventPreviews(args.eventId);
          return invalidateCalendarOccurrences();
        },
      },
      callbacks
    ),
  }));
}

export interface InviteCalendarEventGuestsArgs {
  eventId: string;
  /** Calendar whose copy the invitation goes through. Omit for the canonical copy. */
  calendarId?: string;
  guests: CalendarGuestInputBody[];
  /** How much of a recurring series gains the guests; defaults to all of it. */
  scope?: CalendarInviteScope;
  /** Original-start key of the occurrence a scoped invitation targets. */
  recurrenceId?: string;
  /** Cache key of the occurrence, for the optimistic update. */
  occurrenceKey?: string;
}

/** The cached item with invited guests appended as unanswered. */
function withInvitedGuests(
  item: CalendarOccurrenceItem,
  guests: readonly CalendarGuestInputBody[]
): CalendarOccurrenceItem {
  const present = new Set(
    item.event.attendees.map((attendee) => attendee.email.toLowerCase())
  );
  const added = guests.filter(
    (guest) => !present.has(guest.email.toLowerCase())
  );
  if (added.length === 0) return item;
  return {
    ...item,
    event: {
      ...item.event,
      attendees: [
        ...item.event.attendees,
        ...added.map((guest) => ({
          email: guest.email,
          responseStatus: 'needs_action' as const,
          isOrganizer: false,
          isOptional: guest.optional ?? false,
          isSelf: false,
        })),
      ],
    },
  };
}

function hasCalendarMutationCode(
  error: unknown,
  code: CalendarMutationErrorCode
): boolean {
  return (
    thrownResultErrorHasCode(error, code) ||
    (error instanceof CalendarMutationError && error.code === code)
  );
}

/** Whether a write failed because the organizer does not let the viewer invite guests. */
export function isGuestInviteRefused(error: unknown): boolean {
  return hasCalendarMutationCode(
    error,
    CalendarMutationErrorCode.guests_cannot_invite
  );
}

/** Whether an invitation failed because the organizer hides the guest list from the viewer. */
export function isGuestListHiddenRefusal(error: unknown): boolean {
  return hasCalendarMutationCode(
    error,
    CalendarMutationErrorCode.guest_list_hidden
  );
}

/** Whether a write failed because the organizer does not let the viewer change the event. */
export function isGuestEditRefused(error: unknown): boolean {
  return hasCalendarMutationCode(
    error,
    CalendarMutationErrorCode.guests_cannot_modify
  );
}

/**
 * Whether an invitation reached the provider, or waits in the durable queue
 * until the cache reconnects.
 */
export type InviteCalendarEventGuestsOutcome = 'sent' | 'queued';

type InviteCallbacks = MutationCallbacks<
  InviteCalendarEventGuestsOutcome,
  Error,
  InviteCalendarEventGuestsArgs,
  CalendarMutationContext
>;

async function inviteCalendarEventGuests(
  args: InviteCalendarEventGuestsArgs
): Promise<InviteCalendarEventGuestsOutcome> {
  return Telemetry.span('calendar.invite_guests', async (span) => {
    const host = answeringGraphqlCalendarHost();
    span.setAttr('calendar.event_id', args.eventId);
    span.setAttr('calendar.invite.guest_count', args.guests.length);
    span.setAttr('calendar.invite.scope', args.scope ?? 'all');
    span.setAttr(
      'calendar.invite.one_occurrence',
      args.recurrenceId !== undefined
    );
    span.setAttr('calendar.transport', host ? 'graphql' : 'rest');
    try {
      if (host) {
        const outcome = await executeGraphqlInviteGuests(host, args);
        const result = outcome.kind === 'queued' ? 'queued' : 'sent';
        span.setAttr('calendar.invite.outcome', result);
        return result;
      }
      await throwOnErr(() =>
        emailClient.inviteCalendarEventGuests(args.eventId, {
          calendarId: args.calendarId,
          guests: args.guests,
          scope: args.scope,
          recurrenceId: args.recurrenceId,
        })
      );
      span.setAttr('calendar.invite.outcome', 'sent');
      return 'sent';
    } catch (error) {
      const refused =
        isGuestInviteRefused(error) || isGuestListHiddenRefusal(error);
      span.setAttr('calendar.invite.outcome', refused ? 'refused' : 'failed');
      // Provider messages can quote addresses; record only the category.
      span.error(
        refused ? 'Guest invitation refused' : 'Guest invitation failed'
      );
      throw error;
    }
  });
}

/**
 * Adds guests without replacing the guest list, so a guest the organizer
 * lets invite can use it. The new guests show at once as unanswered on the
 * occurrences the scope covers.
 */
export function useInviteCalendarEventGuestsMutation(
  callbacks?: InviteCallbacks
) {
  return useMutation(() => ({
    mutationFn: inviteCalendarEventGuests,
    ...withCallbacks<
      InviteCalendarEventGuestsOutcome,
      Error,
      InviteCalendarEventGuestsArgs,
      CalendarMutationContext
    >(
      {
        onMutate: (args) =>
          patchOccurrenceCaches(
            patchEventItems(args.eventId, (item) =>
              args.scope === 'this_event' &&
              item.occurrence.occurrenceKey !== args.occurrenceKey
                ? item
                : withInvitedGuests(item, args.guests)
            )
          ),
        onError: (_error, _args, context) => context?.rollback(),
        onSettled: (_data, _error, args) => refreshAfterWrite(args.eventId),
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

async function deleteCalendarEvent(args: DeleteCalendarEventArgs) {
  return Telemetry.span('calendar.delete_event', async (span) => {
    const host = answeringGraphqlCalendarHost();
    span.setAttr('calendar.event_id', args.eventId);
    span.setAttr('calendar.delete.scope', args.scope ?? 'all');
    span.setAttr('calendar.transport', host ? 'graphql' : 'rest');
    try {
      if (host) {
        await executeGraphqlDelete(host, args);
        return;
      }
      return await throwOnErr(() =>
        emailClient.deleteCalendarEvent(args.eventId, {
          calendarId: args.calendarId,
          scope: args.scope,
          recurrenceId: args.recurrenceId,
        })
      );
    } catch (error) {
      // Provider messages can quote addresses; record only the category.
      span.error('Calendar event delete failed');
      throw error;
    }
  });
}

/** Deletes an event (a recurring event's entire series) at the provider. */
export function useDeleteCalendarEventMutation(callbacks?: DeleteCallbacks) {
  return useMutation(() => ({
    mutationFn: deleteCalendarEvent,
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
        onSettled: (_data, _error, args) => refreshAfterWrite(args.eventId),
      },
      callbacks
    ),
  }));
}

export interface UpdateCalendarEventArgs {
  eventId: string;
  /** Calendar whose copy of the event is patched. Omit for the canonical copy. */
  calendarId?: string;
  /** How much of a recurring series to patch; defaults to all of it. */
  scope?: CalendarUpdateScope;
  /** Original-start key of the occurrence a scoped update targets. */
  recurrenceId?: string;
  /** Cache key of the occurrence a scoped update targets, for the optimistic update. */
  occurrenceKey?: string;
  /** Pre-edit times for an occurrence opened without a cached calendar range; never sent. */
  timeBasis?: {
    seriesTime: EventTime;
    recurrenceLines: string[];
    occurrence: Pick<
      CalendarOccurrenceItem['occurrence'],
      'occurrenceKey' | 'recurrenceId' | 'time'
    >;
  };
  /** UI-owned move span; never serialized into the request. */
  parentSpan?: Span;
  /** Shared optimistic cache state is installed; the grid can release its preview. */
  onOptimistic?: () => void;
  /** UI-owned acceptance notification, before occurrence revalidation starts. */
  onWriteAccepted?: () => void;
  patch: Omit<
    UpdateCalendarEventRequest,
    'calendarId' | 'scope' | 'recurrenceId'
  >;
}

/** Tracks a save through the provider write and confirming occurrence refresh. */
export const calendarEventIsUpdating = (eventId: string) =>
  isCalendarEventUpdating(queryClient, eventId);

type UpdateCallbacks = MutationCallbacks<
  CalendarEventEntity | undefined,
  Error,
  UpdateCalendarEventArgs,
  CalendarUpdate
>;

async function updateCalendarEvent(
  args: UpdateCalendarEventArgs
): Promise<CalendarEventEntity | undefined> {
  const writeSession = captureCacheWriteSession();
  const operation = async (span: Span) => {
    const host = answeringGraphqlCalendarHost();
    span.setAttr('calendar.event_id', args.eventId);
    span.setAttr('calendar.update.scope', args.scope ?? 'all');
    span.setAttr('calendar.transport', host ? 'graphql' : 'rest');
    try {
      const prepared = await span.span('calendar.update_queue', () =>
        prepareCalendarUpdate(args)
      );
      if (!writeSession.isCurrent())
        throw new Error('Calendar account changed before saving');
      if (host)
        return committedEvent(
          await span.run(() =>
            executeGraphqlUpdate(host, prepared, undefined, true)
          )
        );
      return await span.run(() =>
        throwOnErr(() =>
          emailClient.updateCalendarEvent(args.eventId, {
            ...prepared.patch,
            calendarId: prepared.calendarId,
            scope: prepared.scope,
            recurrenceId: prepared.recurrenceId,
          })
        )
      );
    } catch (error) {
      // Provider messages can quote addresses; record only the category.
      span.error('Calendar event update failed');
      throw error;
    }
  };
  return args.parentSpan
    ? args.parentSpan.span('calendar.update_event', operation)
    : Telemetry.span('calendar.update_event', operation);
}

/**
 * Patches event fields. A recurring event patches the whole series by
 * default; a `this_event` scope writes the patch as a single-occurrence
 * exception addressed by `recurrenceId`, so the optimistic update lands on
 * that occurrence alone.
 */
export function useUpdateCalendarEventMutation(callbacks?: UpdateCallbacks) {
  return useMutation(() => ({
    mutationFn: updateCalendarEvent,
    ...withCallbacks<
      CalendarEventEntity | undefined,
      Error,
      UpdateCalendarEventArgs,
      CalendarUpdate
    >(
      {
        onMutate: async (args) => {
          occurrenceWriteRevision += 1;
          const context = beginCalendarUpdate(queryClient, args);
          await installCalendarUpdate(queryClient, context);
          return context;
        },
        onSuccess: (_data, args, context) => {
          if (context?.state.isCurrent()) args.onWriteAccepted?.();
        },
        onSettled: (_data, error, args, context) => {
          if (context) settleCalendarUpdate(context.client, context, !error);
          if (
            !context ||
            (context.client === queryClient && context.state.isCurrent())
          ) {
            refreshAfterWrite(args.eventId);
          }
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
 * primary calendar when no `calendarId` is given. With calendar reads on the
 * cache, the event shows at once under a client id the server echo replaces;
 * over REST the entity id is only known once the provider echo lands, so the
 * viewport refetches on settle.
 */
export function useCreateCalendarEventMutation(callbacks?: CreateCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: CreateCalendarEventRequest) => {
      if (answeringGraphqlCalendarHost())
        return (await executeGraphqlCreate(args)).event;
      return await throwOnErr(() => emailClient.createCalendarEvent(args));
    },
    ...withCallbacks<CalendarEventEntity, Error, CreateCalendarEventRequest>(
      {
        onSuccess: (event, args) => {
          analytics.track('calendar_event_created', {
            eventId: event.id,
            attendees: args.attendees?.length ?? 0,
            recurring: (args.recurrenceLines?.length ?? 0) > 0,
            macroCall: args.macroCall === true,
            conference: args.conference != null,
          });
        },
        onSettled: () => invalidateCalendarOccurrences(),
      },
      callbacks
    ),
  }));
}
