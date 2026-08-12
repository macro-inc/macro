import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { CreateReminderRequest } from '@service-storage/generated/schemas/createReminderRequest';
import type { ListRemindersParams } from '@service-storage/generated/schemas/listRemindersParams';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { RemindersList } from '@service-storage/generated/schemas/remindersList';
import type { UpdateReminderRequest } from '@service-storage/generated/schemas/updateReminderRequest';
import { useMutation, useQuery } from '@tanstack/solid-query';

import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';

import { reminderKeys } from './keys';

/** The entity types a reminder can be attached to, as the API names them. */
export type ReminderEntityType = NonNullable<
  CreateReminderRequest['entityType']
>;

/**
 * Maps a frontend entity to the backend reminder entity type, or undefined for
 * entity kinds a reminder cannot be attached to.
 *
 * Mirrors `favoriteEntityType`: both are gated by what the entity-access layer
 * can resolve an access level for, so the two lists move together.
 */
export function reminderEntityType(
  type: EntityData['type']
): ReminderEntityType | undefined {
  switch (type) {
    case 'document':
      return 'document';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'email':
      return 'email_thread';
    case 'channel':
      return 'channel';
    case 'call':
      return 'call';
    case 'crm_company':
      return 'crm_company';
    case 'crm_contact':
      return 'crm_contact';
    // Channel messages and threads have no reminder type of their own —
    // `entity_access` resolves no access level for `channel_message`, so the
    // receipt the reminders API requires cannot be minted. Thread rows attach
    // to their parent channel instead; see `reminderTarget`.
    default:
      return undefined;
  }
}

/** What a reminder attaches to: a backend entity type paired with its id. */
export type ReminderTarget = {
  entityType: NonNullable<ReminderEntityType>;
  entityId: string;
};

/**
 * Resolve what a reminder created from `entity` should point at.
 *
 * Returns the type and the id together because they do not always come from
 * the same place: a thread row attaches to its parent channel, so its
 * `channelId` is the id — pairing `reminderEntityType()` with `entity.id`
 * would store the message id under the `channel` type.
 *
 * A thread reminder pointing at the channel is a deliberate limitation, not an
 * oversight: attaching to the message itself needs `entity_access` to resolve
 * a `ChannelMessage` through its owning channel, which it does not do yet.
 * Opening such a reminder lands on the channel rather than the thread; the
 * description still quotes the message, so the row says which one.
 */
export function reminderTarget(entity: EntityData): ReminderTarget | undefined {
  if (entity.type === 'channel_thread') {
    return { entityType: 'channel', entityId: entity.channelId };
  }
  const entityType = reminderEntityType(entity.type);
  return entityType ? { entityType, entityId: entity.id } : undefined;
}

type CreateReminderArgs = CreateReminderRequest;
type CreateReminderCallbacks = MutationCallbacks<
  Reminder,
  Error,
  CreateReminderArgs
>;

/**
 * Set a reminder's completed flag.
 *
 * Bulk done/not-done runs over a mixed selection (emails, notifications,
 * reminders) with one shared optimistic layer, so it drives the writes itself
 * rather than through a mutation per row. The service call still belongs
 * here; `next-soup/utils` keeps only the orchestration.
 */
export async function setReminderCompleted(id: string, completed: boolean) {
  return await throwOnErr(() =>
    storageServiceClient.reminders.updateReminder(id, { completed })
  );
}

/**
 * Invalidate the lists plus each of the given reminder details.
 *
 * `refetch` should be true only when the server state is unknown — after a
 * failed or partly-failed write. On success the optimistic layer already
 * holds the right values, and an immediate refetch would detach the list's
 * Suspense boundary and reset its scroll.
 */
export function invalidateRemindersById(
  ids: string[],
  { refetch = false }: { refetch?: boolean } = {}
) {
  if (ids.length === 0) return;
  const refetchType = refetch ? undefined : ('none' as const);
  void queryClient.invalidateQueries({
    queryKey: reminderKeys.list._def,
    refetchType,
  });
  for (const id of ids) {
    void queryClient.invalidateQueries({
      queryKey: reminderKeys.detail(id).queryKey,
      refetchType,
    });
  }
}

/** Invalidate every reminder list, plus one detail when the id is known. */
function invalidateReminders(id?: string) {
  void queryClient.invalidateQueries({ queryKey: reminderKeys.list._def });
  if (id) {
    void queryClient.invalidateQueries({
      queryKey: reminderKeys.detail(id).queryKey,
    });
  }
}

/**
 * Create a reminder.
 *
 * Not optimistic: a reminder's `nextRunAt` is derived server-side from its
 * schedule, so an optimistic row would sort into the wrong place until the
 * response lands. Lists are invalidated instead.
 */
export function useCreateReminderMutation(callbacks?: CreateReminderCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: CreateReminderArgs) =>
      await throwOnErr(() =>
        storageServiceClient.reminders.createReminder(args)
      ),
    ...withCallbacks<Reminder, Error, CreateReminderArgs>(
      { onSettled: () => invalidateReminders() },
      callbacks
    ),
  }));
}

/** One page of the caller's reminders, soonest firing first. */
export function useRemindersQuery(
  params: () => ListRemindersParams = () => ({})
) {
  return useQuery(() => ({
    queryKey: reminderKeys.list(params()).queryKey,
    queryFn: async () =>
      await throwOnErr(() =>
        storageServiceClient.reminders.listReminders(params())
      ),
  }));
}

/**
 * Fetch one reminder outside a component, going through the query cache so a
 * reminder already on screen is not re-fetched.
 *
 * Used by notification navigation, which has to read a reminder's referenced
 * entity before it knows what to open.
 */
export async function getReminderById(
  id: string
): Promise<Reminder | undefined> {
  try {
    return await queryClient.fetchQuery({
      queryKey: reminderKeys.detail(id).queryKey,
      queryFn: async () =>
        await throwOnErr(() => storageServiceClient.reminders.getReminder(id)),
    });
  } catch {
    return undefined;
  }
}

/** A single reminder by id. */
export function useReminderQuery(id: () => string | undefined) {
  return useQuery(() => ({
    queryKey: reminderKeys.detail(id() ?? '').queryKey,
    queryFn: async () =>
      await throwOnErr(() =>
        storageServiceClient.reminders.getReminder(id() as string)
      ),
    enabled: !!id(),
  }));
}

type UpdateReminderArgs = { id: string; patch: UpdateReminderRequest };
type UpdateReminderCallbacks = MutationCallbacks<
  Reminder,
  Error,
  UpdateReminderArgs
>;

/**
 * The Soup-cache patch that brings a row in line with `reminder`.
 *
 * Only the shape lives here — applying it does not. Soup's cache module reaches
 * back into `queryClient`, so importing it from `lib/queries` closes an
 * initialization cycle; every soup write in the app is made from `features/`
 * for that reason. See `ReminderComposerModal`, which performs this one.
 *
 * `existingFrecencyScore` is the row's current score, or undefined when it is
 * not in the cache.
 */
export function reminderSoupPatch(
  reminder: Reminder,
  existingFrecencyScore: number | undefined
) {
  return {
    tag: 'reminder' as const,
    data: {
      id: reminder.id,
      description: reminder.description,
      schedule: reminder.schedule,
      // Drives both the row's "next run" and which tab it belongs to: Active
      // and Scheduled split on whether this has passed.
      nextRunAt: reminder.nextRunAt,
      enabled: reminder.enabled,
      // Explicitly null rather than omitted. The cache merges field by field,
      // so leaving the key out would keep a stale `completedAt` — and a
      // rescheduled reminder that cleared it would stay filed under Done.
      completedAt: reminder.completedAt ?? null,
      updatedAt: reminder.updatedAt,
    },
    frecency_score: existingFrecencyScore ?? 0,
  };
}

/**
 * Modify a reminder's description, schedule, or enabled flag.
 *
 * Invalidating these queries is not enough to refresh a Soup row — Soup serves
 * rows from its own normalized cache. Callers that render into Soup should pass
 * an `onSuccess` that applies {@link reminderSoupPatch}, or the edit will not
 * show until a reload.
 */
export function useUpdateReminderMutation(callbacks?: UpdateReminderCallbacks) {
  return useMutation(() => ({
    mutationFn: async ({ id, patch }: UpdateReminderArgs) =>
      await throwOnErr(() =>
        storageServiceClient.reminders.updateReminder(id, patch)
      ),
    ...withCallbacks<Reminder, Error, UpdateReminderArgs>(
      { onSettled: (_data, _error, args) => invalidateReminders(args?.id) },
      callbacks
    ),
  }));
}

type DeleteReminderCallbacks = MutationCallbacks<void, Error, string>;

/**
 * Delete a reminder.
 *
 * The delete is a hard delete server-side, so any notification it already
 * produced outlives it — see the retraction note on the reminders service.
 */
export function useDeleteReminderMutation(callbacks?: DeleteReminderCallbacks) {
  return useMutation(() => ({
    mutationFn: async (id: string) =>
      await throwOnErr(() => storageServiceClient.reminders.deleteReminder(id)),
    ...withCallbacks<void, Error, string>(
      { onSettled: (_data, _error, id) => invalidateReminders(id) },
      callbacks
    ),
  }));
}

export type { RemindersList };
