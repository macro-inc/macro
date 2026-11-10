import type { MessageThread } from '@service-storage/messages';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import { recordingChatMessages } from '../core/recording-chat';

/** Keep linked discussion targets aligned with the rendered recording chat. */
export function createRecordingChat(options: {
  source: { thread: () => MessageThread | undefined };
  targetId?: string;
  requestKey?: string | number;
}) {
  const messages = createMemo(() =>
    recordingChatMessages(options.source.thread())
  );
  const rows = new Map<string, HTMLDivElement>();
  createEffect(
    on(
      () => [options.targetId, options.requestKey, messages()] as const,
      ([id]) => {
        if (!id) return;
        rows.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    )
  );
  return {
    messages,
    registerRow: (id: string, element: HTMLDivElement) => {
      rows.set(id, element);
      onCleanup(() => rows.delete(id));
    },
  };
}
