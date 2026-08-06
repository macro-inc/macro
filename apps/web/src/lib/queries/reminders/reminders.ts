import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { CreateReminderRequest } from '@service-storage/generated/schemas/createReminderRequest';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { useMutation } from '@tanstack/solid-query';

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
    // Channel messages and threads are excluded for the same reason favorites
    // excludes them: their frontend id is a composite `channelId:messageId`
    // that the entity-access layer has no access level for.
    default:
      return undefined;
  }
}

type CreateReminderArgs = CreateReminderRequest;
type CreateReminderCallbacks = MutationCallbacks<
  Reminder,
  Error,
  CreateReminderArgs
>;

/**
 * Create a reminder.
 *
 * Not optimistic: nothing renders a reminder list yet, so there is no cache to
 * update ahead of the server. The list key is invalidated so whatever reads it
 * first sees the new row.
 */
export function useCreateReminderMutation(callbacks?: CreateReminderCallbacks) {
  return useMutation(() => ({
    mutationFn: async (args: CreateReminderArgs) =>
      await throwOnErr(() =>
        storageServiceClient.reminders.createReminder(args)
      ),
    ...withCallbacks<Reminder, Error, CreateReminderArgs>(
      {
        onSettled: () =>
          queryClient.invalidateQueries({
            queryKey: reminderKeys.list.queryKey,
          }),
      },
      callbacks
    ),
  }));
}
