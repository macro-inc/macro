import { trimEdgeUserMentions } from '@core/util/taskExtraction';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import { openDialog } from '@ui';
import { MessageReminderComposer } from './views/message-reminder-composer';

function reminderDescription(content: string) {
  const plain = markdownToPlainText(trimEdgeUserMentions(content))
    .trim()
    .replace(/\s+/g, ' ');
  if (!plain) return 'Message';
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
}

/** Open the time picker for a reminder on this channel message. */
export function openChannelMessageReminder(input: {
  channelId: string;
  message: { id: string; content: string };
}) {
  openDialog(MessageReminderComposer, {
    channelId: input.channelId,
    messageId: input.message.id,
    description: reminderDescription(input.message.content),
  });
}
