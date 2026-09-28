import { normalizeMessageSender } from '@queries/messages/message-sender';
import type { Message } from '@service-storage/messages';
import type { MessageData } from './types';

/** Native messages retain their full shape while adding sender presentation. */
export function messageToMessageData(message: Message): MessageData {
  return normalizeMessageSender(message);
}
