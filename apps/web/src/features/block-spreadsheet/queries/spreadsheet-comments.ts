import { WebsocketConnectionState } from '@macro-inc/collaboration/websocket';
import {
  state as connectionState,
  createConnectionWebsocketEffect,
} from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { CreateCommentRequest } from '@service-storage/generated/schemas/createCommentRequest';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, on } from 'solid-js';
import { spreadsheetCommentKeys } from './keys';

/** Uses the document annotation routes: ownership, mentions, inbox and live events
 * are handled by the same backend as document/task discussions. */
export function spreadsheetCommentsApi(documentId: string) {
  return {
    async list() {
      const result = await storageServiceClient.annotations.getComments({
        documentId,
      });
      if (result.isErr()) throw new Error('Unable to load comments.');
      return result.value.data;
    },
    async create(body: CreateCommentRequest) {
      const result = await storageServiceClient.annotations.createComment({
        documentId,
        body,
      });
      if (result.isErr())
        throw new Error('Unable to post comment. Your draft has been kept.');
      return result.value;
    },
    async edit(commentId: number, threadId: number, text: string) {
      const result = await storageServiceClient.annotations.editComment({
        commentId,
        body: { threadId, text },
      });
      if (result.isErr())
        throw new Error('Unable to edit comment. Your draft has been kept.');
      return result.value;
    },
    async delete(commentId: number) {
      const result = await storageServiceClient.annotations.deleteComment({
        commentId,
        body: {},
      });
      if (result.isErr()) throw new Error('Unable to delete comment.');
      return result.value;
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
    if (message.type !== 'comment') return;
    try {
      const event = JSON.parse(message.data);
      if (event?.payload?.documentId === documentId) void refresh();
    } catch {
      /* Ignore malformed connection events. */
    }
  });
  return { query, api, refresh };
}
