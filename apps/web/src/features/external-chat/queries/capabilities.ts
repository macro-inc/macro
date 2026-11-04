import { staticFileIdEndpoint } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type ExternalChatApi,
  invalidateExternalChat,
  invalidateExternalChatList,
  refreshExternalChatTimeline,
  useExternalChatDeliveryQuery,
  useExternalChatQueries,
} from '@queries/external-chats';
import { useExternalChatSync } from '@queries/external-chats/sync';
import { queryReadyGate } from '@queries/gate';
import type { UseQueryResult } from '@tanstack/solid-query';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type { ExternalChatCapabilities } from '../context/external-chat-context';
import type { ChatMessage } from '../core/chat';

function sourceRead<T>(query: UseQueryResult<T>): SourceRead<T> {
  return {
    get data() {
      return queryReadyGate(query) ? query.data : undefined;
    },
    get isPending() {
      return query.isPending;
    },
    get isError() {
      return query.isError;
    },
    refetch: () => fireAndForget(query.refetch(), 'external-chat.refresh'),
  };
}

/** `external_chat.open`: from mount until the members and first page show. */
function traceOpen(
  chatId: Accessor<string>,
  queries: ReturnType<typeof useExternalChatQueries>
) {
  const span = Telemetry.span('external_chat.open');
  span.setAttr('external_chat.id', chatId());
  let ended = false;
  const end = (outcome: string) => {
    if (ended) return;
    ended = true;
    span.setAttr('external_chat.outcome', outcome);
    span.end();
  };
  createEffect(() => {
    if (queries.chat.isError || queries.messages.isError) {
      span.error('External chat failed to load');
      end('error');
    } else if (queries.chat.isSuccess && queries.messages.isSuccess) {
      span.setAttr(
        'external_chat.messages',
        queries.messages.data.pages[0]?.messages.length ?? 0
      );
      end('success');
    }
  });
  onCleanup(() => end('closed'));
}

/** One write's span; server error bodies stay out of it. */
function chatOperation<T>(
  name: string,
  chatId: string,
  operation: () => Promise<T>
) {
  return Telemetry.span(`external_chat.${name}`, async (span) => {
    span.setAttr('external_chat.id', chatId);
    try {
      const result = await operation();
      span.setAttr('external_chat.outcome', 'success');
      return result;
    } catch (error) {
      span.error(`External chat ${name} failed`);
      throw error;
    }
  });
}

/** Mounted sources own row reconciliation; cached query callbacks own only resolved IDs. */
export function createExternalChatCapabilities(
  api: ExternalChatApi,
  userId: Accessor<string>,
  chatId: Accessor<string>
): ExternalChatCapabilities {
  const queries = useExternalChatQueries(api, userId, chatId);
  useExternalChatSync(userId, chatId);
  traceOpen(chatId, queries);
  const [rows, setRows] = createStore<ChatMessage[]>([]);
  createEffect(
    on(
      () => queryReadyGate(queries.messages) && queries.messages.data.pages,
      (pages) => {
        if (!pages) return;
        const byId = new Map<string, ChatMessage>();
        for (const page of [...pages].reverse()) {
          for (const message of page.messages) byId.set(message.id, message);
        }
        setRows(
          reconcile(
            [...byId.values()].sort(
              (a, b) =>
                Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
                a.id.localeCompare(b.id)
            ),
            { key: 'id' }
          )
        );
      }
    )
  );
  return {
    chat: sourceRead(queries.chat),
    timeline: {
      get data() {
        return queryReadyGate(queries.messages) ? rows : undefined;
      },
      get isPending() {
        return queries.messages.isPending;
      },
      get isError() {
        return queries.messages.isError;
      },
      refetch: () =>
        fireAndForget(queries.messages.refetch(), 'external-chat.refresh'),
    },
    hasOlder: () => queries.messages.hasNextPage,
    loadingOlder: () => queries.messages.isFetchingNextPage,
    loadOlder: async () =>
      !(await queries.messages.fetchNextPage()).isFetchNextPageError,
    send: (request, idempotencyKey) =>
      Telemetry.span('external_chat.send.attempt', async (span) => {
        span.setAttr('external_chat.id', chatId());
        span.setAttr('external_chat.send.kind', request.kind);
        const result = await api.send(chatId(), request, idempotencyKey);
        if (result.isOk()) {
          span.setAttr('external_chat.send.id', result.value.id);
          span.setAttr('external_chat.outcome', 'recorded');
          fireAndForget(
            refreshExternalChatTimeline(userId(), chatId()),
            'external-chat.send'
          );
        } else {
          span.setAttr('external_chat.outcome', result.error.kind);
          if (result.error.kind === 'refused')
            span.error('The provider refused the send');
        }
        return result;
      }),
    delivery: (sendIds) =>
      sourceRead(useExternalChatDeliveryQuery(api, userId, chatId, sendIds)),
    upload: (file) =>
      Telemetry.span('external_chat.upload', async (span) => {
        span.setAttr('external_chat.id', chatId());
        span.setAttr('external_chat.upload.size', file.size);
        const result = await api.upload(chatId(), file);
        span.setAttr(
          'external_chat.outcome',
          result.isOk() ? 'success' : result.error.kind
        );
        return result;
      }),
    fileUrl: staticFileIdEndpoint,
    markRead: async (messageId) => {
      await chatOperation('read', chatId(), () =>
        api.markRead(chatId(), messageId)
      );
      await invalidateExternalChatList();
    },
    stopSync: async () => {
      await chatOperation('stop_sync', chatId(), () => api.stopSync(chatId()));
      invalidateExternalChat(chatId());
    },
    importHistory: async () => {
      await chatOperation('import_history', chatId(), () =>
        api.importHistory()
      );
      invalidateExternalChat(chatId());
    },
  };
}
