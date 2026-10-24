/** Gateway liveness for WhatsApp, apart from `./index` to keep the websocket out of startup. */

import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { debounce } from '@solid-primitives/scheduled';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { queryClient } from '../client';
import { parseMessageData } from '../storage/databases-sync';
import { whatsappLinkedKeys } from '../whatsapp-linked/keys';
import { whatsappGroupsKeys } from './keys';

/** DSS pings this with no data; readers re-fetch. */
const WHATSAPP_CHANGED_MESSAGE_TYPE = 'whatsapp_changed';
const whatsappChangedSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('groups') }),
  z.object({ scope: z.literal('group'), group_id: z.string() }),
]);
type WhatsappChange = z.infer<typeof whatsappChangedSchema>;

/**
 * Opening a page asks DSS for a WhatsApp refresh that can finish before this
 * subscription exists; without a push by then, re-fetch once.
 */
const WHATSAPP_FALLBACK_REFETCH_MS = 3000;

function onWhatsappChanged(handle: (change: WhatsappChange) => void) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== WHATSAPP_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, whatsappChangedSchema);
    if (change) handle(change);
  });
}

/** Schedules one re-fetch, cleared by the first push or by unmount. */
function fallbackRefetch(refetch: () => void) {
  const scheduled = debounce(refetch, WHATSAPP_FALLBACK_REFETCH_MS);
  scheduled();
  return scheduled.clear;
}

const refreshGroupLists = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: whatsappLinkedKeys.chats._def }),
    queryClient.invalidateQueries({ queryKey: whatsappGroupsKeys.list._def }),
  ]);

/**
 * While External is open: the owner's WhatsApp chat list (`groups`) and every
 * readable group's summary (`group`, for unread counts and names).
 */
export function useWhatsappGroupListsSync() {
  const cancel = fallbackRefetch(() =>
    fireAndForget(
      Telemetry.span('whatsapp.groups.fallback_refetch', refreshGroupLists),
      'whatsapp-sync'
    )
  );
  onWhatsappChanged((change) => {
    cancel();
    if (change.scope === 'groups') {
      queryClient.invalidateQueries({
        queryKey: whatsappLinkedKeys.chats._def,
      });
    }
    queryClient.invalidateQueries({ queryKey: whatsappGroupsKeys.list._def });
  });
}

function refreshGroup(userId: string, groupId: string) {
  return Promise.all(
    [
      whatsappGroupsKeys.detail(userId, groupId).queryKey,
      whatsappGroupsKeys.messages(userId, groupId).queryKey,
      whatsappGroupsKeys.delivery(userId, groupId).queryKey,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}

/** While one group is open: its roster, timeline and send outcomes. */
export function useWhatsappGroupSync(
  userId: Accessor<string>,
  groupId: Accessor<string>
) {
  const cancel = fallbackRefetch(() =>
    fireAndForget(
      Telemetry.span('whatsapp.group.fallback_refetch', (span) => {
        span.setAttr('whatsapp.group.id', groupId());
        return refreshGroup(userId(), groupId());
      }),
      'whatsapp-sync'
    )
  );
  onWhatsappChanged((change) => {
    if (change.scope !== 'group' || change.group_id !== groupId()) return;
    cancel();
    fireAndForget(refreshGroup(userId(), groupId()), 'whatsapp-sync');
  });
}
