import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { Telemetry } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { createVisibleRefresh } from '@queries/visible-refresh';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
  ws,
} from '@service-connection/websocket';
import type { RefreshEmailEvent } from '@service-email/generated/schemas';
import { makeEventListener } from '@solid-primitives/event-listener';
import { onCleanup } from 'solid-js';

const LIST_REFRESH_INTERVAL_MS = 5_000;
const LIST_EVENTS = new Set([
  'upsert_message',
  'update_labels',
  'delete_message',
  'backfill',
  'backfill_progress',
  'link_removed',
]);

/** Link refreshes are independent of signal notifications and cache membership. */
export function useEmailListRefresh(options: {
  enabled: () => boolean;
  scope: () => string;
  matchesLink: (linkId: string) => boolean;
  refresh: () => Promise<void>;
}) {
  let account: QueryAccount | undefined;
  let scope: string | undefined;
  const pendingLinks = new Set<string>();
  let catchUp = false;
  let urgent = false;

  const request = (linkId?: string, immediate = false) => {
    const current = currentQueryAccount();
    if (!current || !options.enabled()) return;
    if (linkId && !options.matchesLink(linkId)) return;
    const nextScope = options.scope();
    if (
      current.userId !== account?.userId ||
      current.session !== account?.session ||
      nextScope !== scope
    ) {
      pendingLinks.clear();
      catchUp = false;
      urgent = false;
    }
    account = current;
    scope = nextScope;
    if (linkId) pendingLinks.add(linkId);
    else catchUp = true;
    urgent ||= immediate;
    visible.markDirty();
  };

  // Capture the current account/scope before the shared visibility scheduler
  // releases a hidden dirty batch; old inbox work must not refresh a new view.
  const removeVisibility = makeEventListener(
    document,
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') request(undefined, true);
    }
  );
  const visible = createVisibleRefresh(
    async () => {
      const owner = account;
      const requestScope = scope;
      const links = [...pendingLinks];
      const forced = catchUp;
      pendingLinks.clear();
      catchUp = false;
      urgent = false;
      if (
        !owner ||
        !isCurrentQueryAccount(owner) ||
        requestScope !== options.scope() ||
        !options.enabled() ||
        (!forced && !links.some(options.matchesLink))
      )
        return;
      await Telemetry.span('email.list.refresh', async (span) => {
        span.setAttr('email.refresh.link_count', links.length);
        await options.refresh();
      });
    },
    { intervalMs: () => (urgent ? 0 : LIST_REFRESH_INTERVAL_MS) }
  );

  createConnectionWebsocketEffect((message) => {
    if (message.type !== 'refresh_email') return;
    const event = parseWebsocketPayload<RefreshEmailEvent>(
      message.type,
      message.data
    );
    if (
      !event ||
      !LIST_EVENTS.has(event.event) ||
      typeof event.link_id !== 'string'
    )
      return;
    const complete =
      (event.event === 'backfill' || event.event === 'backfill_progress') &&
      event.status === 'complete';
    request(event.link_id, complete);
  });
  const reconnect = () => request(undefined, true);
  ws.addEventListener(WebsocketEvent.Reconnect, reconnect);
  onCleanup(() => {
    ws.removeEventListener(WebsocketEvent.Reconnect, reconnect);
    removeVisibility();
    visible.dispose();
  });
}
