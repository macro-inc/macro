import { WebsocketConnectionState } from '@macro-inc/collaboration/websocket';
import {
  state as connectionState,
  createConnectionWebsocketEffect,
} from '@service-connection/websocket';
import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import {
  entityMessagesClient,
  type Message,
  type MessageCursor,
  type MessageParent,
  type MessageThread,
  type PostMessage,
} from '@service-storage/messages';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, on } from 'solid-js';
import { spreadsheetCommentKeys } from './keys';

/** Spreadsheet comments are the document's message threads; a cell range is the thread anchor. */
export function spreadsheetCommentsApi(documentId: string) {
  const parent: MessageParent = { type: 'document', id: documentId };
  const attempt = async <T>(operation: () => Promise<T>, message: string) => {
    try {
      return await operation();
    } catch (cause) {
      throw new Error(message, { cause });
    }
  };
  return {
    parent,
    /** Every thread with all of its replies; the Discussion UI shows whole threads. */
    async list(): Promise<MessageThread[]> {
      return attempt(async () => {
        const threads: MessageThread[] = [];
        let cursor: MessageCursor | null | undefined;
        do {
          const page = await entityMessagesClient.list(parent, {
            limit: 100,
            cursor: cursor ?? undefined,
          });
          for (const root of page.items) {
            if (root.state.deleted_at) continue;
            threads.push(await entityMessagesClient.thread(parent, root.id));
          }
          cursor = page.next_cursor;
        } while (cursor);
        return threads;
      }, 'Unable to load comments.');
    },
    create(input: PostMessage): Promise<Message> {
      return attempt(
        () => entityMessagesClient.post(parent, input),
        'Unable to post comment. Your draft has been kept.'
      );
    },
    edit(
      messageId: string,
      content: string,
      mentions: SimpleMention[]
    ): Promise<Message> {
      return attempt(
        () =>
          entityMessagesClient.patch(parent, messageId, { content, mentions }),
        'Unable to edit comment. Your draft has been kept.'
      );
    },
    delete(messageId: string): Promise<Message> {
      return attempt(
        () => entityMessagesClient.delete(parent, messageId),
        'Unable to delete comment.'
      );
    },
  };
}

export function useSpreadsheetComments(documentId: string) {
  const api = spreadsheetCommentsApi(documentId);
  const client = useQueryClient();
  const queryKey = spreadsheetCommentKeys.document(documentId).queryKey;
  const query = useQuery(() => ({
    queryKey,
    queryFn: api.list,
    staleTime: 30_000,
  }));
  const refresh = () => client.invalidateQueries({ queryKey });
  // Recover comments missed while the connection gateway was disconnected.
  createEffect(
    on(
      connectionState,
      (state) => {
        if (state === WebsocketConnectionState.Open) void refresh();
      },
      { defer: true }
    )
  );
  createConnectionWebsocketEffect((message) => {
    if (message.type !== 'message_update') return;
    try {
      const event = JSON.parse(message.data) as MessageEvent;
      if (
        event?.parent?.type === 'document' &&
        event.parent.id === documentId &&
        event.change?.type !== 'typing'
      )
        void refresh();
    } catch {
      /* Ignore malformed connection events. */
    }
  });
  return { query, api, refresh };
}
