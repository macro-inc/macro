import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  invalidateWhatsappGroups,
  useWhatsappGroupQueries,
  type WhatsAppGroupApi,
} from '@queries/whatsapp-groups';
import { whatsappOperation } from '@queries/whatsapp-linked/operation';
import type { UseQueryResult } from '@tanstack/solid-query';
import { type Accessor, createEffect } from 'solid-js';
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
/** Mounted sources own row reconciliation; cached query callbacks own only resolved IDs. */
export function createWhatsAppGroupCapabilities(
  api: WhatsAppGroupApi,
  userId: Accessor<string>,
  groupId: Accessor<string>
): WhatsAppGroupCapabilities {
  const queries = useWhatsappGroupQueries(api, userId, groupId);
  const [rows, setRows] = createStore<GroupMessage[]>([]);
  createEffect(() => {
    if (!queryReadyGate(queries.messages)) return;
    const byId = new Map<string, GroupMessage>();
    for (const page of [...queries.messages.data.pages].reverse()) {
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
  });
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
    sends: sourceRead(queries.sends),
    hasOlder: () => queries.messages.hasNextPage,
    loadingOlder: () => queries.messages.isFetchingNextPage,
    loadOlder: () => queries.messages.fetchNextPage(),
    send: (request, idempotencyKey) =>
      queries.send.mutateAsync({
        userId: userId(),
        groupId: groupId(),
        request,
        idempotencyKey,
      }),
    upload: (file) =>
      whatsappOperation(
        'group.upload',
        () => api.upload(groupId(), file),
        groupId()
      ),
    markRead: async (messageId) => {
      await whatsappOperation(
        'group.read',
        () => api.markRead(groupId(), messageId),
        groupId()
      );
      await invalidateWhatsappGroups();
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
