import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { queryReadyGate } from '@queries/gate';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import {
  invalidateWhatsappGroupList,
  invalidateWhatsappGroups,
  refreshWhatsappGroupTimeline,
  useWhatsappGroupDeliveryQuery,
  useWhatsappGroupQueries,
  type WhatsAppGroupApi,
} from '@queries/whatsapp-groups';
import { useWhatsappGroupSync } from '@queries/whatsapp-groups/sync';
import { whatsappOperation } from '@queries/whatsapp-linked/operation';
import type { UseQueryResult } from '@tanstack/solid-query';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type { WhatsAppGroupCapabilities } from '../context/whatsapp-group-context';
import type { GroupMessage } from '../core/group';

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
    refetch: () => fireAndForget(query.refetch(), 'whatsapp-group.refresh'),
  };
}

/** `whatsapp.group.open`: from mount until the roster and first page show. */
function traceOpen(
  groupId: Accessor<string>,
  queries: ReturnType<typeof useWhatsappGroupQueries>
) {
  const span = Telemetry.span('whatsapp.group.open');
  span.setAttr('whatsapp.group.id', groupId());
  let ended = false;
  const end = (outcome: string) => {
    if (ended) return;
    ended = true;
    span.setAttr('whatsapp.outcome', outcome);
    span.end();
  };
  createEffect(() => {
    if (queries.group.isError || queries.messages.isError) {
      span.error('WhatsApp group failed to load');
      end('error');
    } else if (queries.group.isSuccess && queries.messages.isSuccess) {
      span.setAttr(
        'whatsapp.group.messages',
        queries.messages.data.pages[0]?.messages.length ?? 0
      );
      end('success');
    }
  });
  onCleanup(() => end('closed'));
}

/** Mounted sources own row reconciliation; cached query callbacks own only resolved IDs. */
export function createWhatsAppGroupCapabilities(
  api: WhatsAppGroupApi,
  userId: Accessor<string>,
  groupId: Accessor<string>
): WhatsAppGroupCapabilities {
  const queries = useWhatsappGroupQueries(api, userId, groupId);
  useWhatsappGroupSync(userId, groupId);
  traceOpen(groupId, queries);
  const [rows, setRows] = createStore<GroupMessage[]>([]);
  createEffect(
    on(
      () => queryReadyGate(queries.messages) && queries.messages.data.pages,
      (pages) => {
        if (!pages) return;
        const byId = new Map<string, GroupMessage>();
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
    group: sourceRead(queries.group),
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
        fireAndForget(queries.messages.refetch(), 'whatsapp-group.refresh'),
    },
    hasOlder: () => queries.messages.hasNextPage,
    loadingOlder: () => queries.messages.isFetchingNextPage,
    loadOlder: () => queries.messages.fetchNextPage(),
    send: (request, idempotencyKey) =>
      Telemetry.span('whatsapp.group.send.attempt', async (span) => {
        span.setAttr('whatsapp.group.id', groupId());
        span.setAttr('whatsapp.send.kind', request.kind);
        const result = await api.send(groupId(), request, idempotencyKey);
        if (result.isOk()) {
          span.setAttr('whatsapp.send.id', result.value.id);
          span.setAttr('whatsapp.outcome', 'recorded');
          fireAndForget(
            refreshWhatsappGroupTimeline(userId(), groupId()),
            'whatsapp-group.send'
          );
        } else {
          span.setAttr('whatsapp.outcome', result.error.kind);
          if (result.error.kind === 'refused')
            span.error('WhatsApp refused the send');
        }
        return result;
      }),
    delivery: (sendIds) =>
      sourceRead(useWhatsappGroupDeliveryQuery(api, userId, groupId, sendIds)),
    upload: (file) =>
      Telemetry.span('whatsapp.group.upload', async (span) => {
        span.setAttr('whatsapp.group.id', groupId());
        span.setAttr('whatsapp.upload.size', file.size);
        const result = await api.upload(groupId(), file);
        span.setAttr(
          'whatsapp.outcome',
          result.isOk() ? 'success' : result.error.kind
        );
        return result;
      }),
    fileUrl: (documentId) => sourceRead(useBinaryDocumentQuery(documentId)),
    markRead: async (messageId) => {
      await whatsappOperation(
        'group.read',
        () => api.markRead(groupId(), messageId),
        groupId()
      );
      await invalidateWhatsappGroupList();
    },
    stopSync: async () => {
      await whatsappOperation(
        'group.stop_sync',
        () => api.stopSync(groupId()),
        groupId()
      );
      await invalidateWhatsappGroups();
    },
  };
}
