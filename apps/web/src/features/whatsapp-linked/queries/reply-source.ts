import {
  useLinkedChannel,
  useLinkedReply,
  useLinkedUpload,
} from '@queries/whatsapp-linked';
import type { ReplySource } from '../../meta-messaging/context/reply-source';
/** Same native composer, with only the authenticated person's sending account. */
export function createLinkedReplySource(channel: string): ReplySource {
  const state = useLinkedChannel(
    () => channel,
    () => true
  );
  const reply = useLinkedReply(() => channel);
  const upload = useLinkedUpload(() => channel);
  return {
    send: (request) => reply.mutateAsync(request),
    isSending: () => reply.isPending,
    isQueued: (intent) =>
      state.data?.sends.some(
        (send) => send.payload.idempotency_key === intent
      ) ?? false,
    upload: (file) => upload.mutateAsync(file),
    isUploading: () => upload.isPending,
    templates: () => ({
      items: () => [],
      ready: () => true,
      failed: () => false,
      refresh: async () => undefined,
    }),
  };
}
