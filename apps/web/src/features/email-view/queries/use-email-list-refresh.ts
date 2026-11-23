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
import { until } from '@solid-primitives/promise';
import { debounce } from '@solid-primitives/scheduled';
import { getOwner, onCleanup, runWithOwner } from 'solid-js';

const LIST_REFRESH_INTERVAL_MS = 5_000;
const RECONNECT_SPREAD_MS = 2_000;
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
  isFetching: () => boolean;
  refresh: (catchUp: boolean) => Promise<void>;
}) {
  const owner = getOwner();
  let disposed = false;
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

  const visible = createVisibleRefresh(
    async () => {
      // Keep hints pending until paging settles, including the background
      // server page that keeps a locally cached Mail list at the same depth.
      try {
        await runWithOwner(owner, () => until(() => !options.isFetching()));
      } catch (error) {
        if (disposed) return;
        throw error;
      }
      if (disposed) return;
      const accountOwner = account;
      const requestScope = scope;
      const links = [...pendingLinks];
      const forced = catchUp;
      pendingLinks.clear();
      catchUp = false;
      urgent = false;
      if (
        !accountOwner ||
        !isCurrentQueryAccount(accountOwner) ||
        requestScope !== options.scope() ||
        !options.enabled() ||
        (!forced && !links.some(options.matchesLink))
      )
        return;
      try {
        await Telemetry.span('email.list.refresh', async (span) => {
          span.setAttr('email.refresh.link_count', links.length);
          await options.refresh(forced);
        });
      } catch (error) {
        if (!disposed) throw error;
      }
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
  const reconnect = debounce(
    (account: QueryAccount | undefined, scope: string) => {
      if (
        !account ||
        !isCurrentQueryAccount(account) ||
        scope !== options.scope()
      )
        return;
      request(undefined, true);
    },
    250 + Math.floor(Math.random() * (RECONNECT_SPREAD_MS - 250))
  );
  const onReconnect = () => reconnect(currentQueryAccount(), options.scope());
  ws.addEventListener(WebsocketEvent.Reconnect, onReconnect);
  onCleanup(() => {
    disposed = true;
    ws.removeEventListener(WebsocketEvent.Reconnect, onReconnect);
    reconnect.clear();
    visible.dispose();
  });
}
