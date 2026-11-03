import { throwOnErr } from '@core/util/result';
import type { SetChannelMessageReminder } from '@service-storage/client';
import { storageServiceClient } from '@service-storage/client';

export async function readChannelMessageReminder(
  channelId: string,
  messageId: string
) {
  const response = await throwOnErr(() =>
    storageServiceClient.reminders.getChannelMessageReminder(
      channelId,
      messageId
    )
  );
  return response.reminder;
}

export async function saveChannelMessageReminder(
  channelId: string,
  messageId: string,
  command: SetChannelMessageReminder
) {
  return await throwOnErr(() =>
    storageServiceClient.reminders.setChannelMessageReminder(
      channelId,
      messageId,
      command
    )
  );
}

export async function removeChannelMessageReminder(
  channelId: string,
  messageId: string
) {
  return await throwOnErr(() =>
    storageServiceClient.reminders.removeChannelMessageReminder(
      channelId,
      messageId
    )
  );
}
