import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { type EmailEntity, isEmailEntity } from '@entity';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
  ws,
} from '@service-connection/websocket';
import type { RefreshEmailEvent } from '@service-email/generated/schemas';
import {
  EmailFocusDocument,
  type EmailFocusQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupItem,
} from '@service-storage/graphql-soup';
import { type Accessor, onCleanup } from 'solid-js';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '../soup/transform-utils';
import { createVisibleRefresh } from '../visible-refresh';

/** Days of mail the Focus list covers. */
export const FOCUS_WINDOW_DAYS = 30;

/**
 * The viewer's Focus threads as email rows, in the server's newest-first order,
 * each carrying its classification in `focus`.
 */
export function mapEmailFocus(data: EmailFocusQuery): EmailEntity[] {
  const threads: EmailEntity[] = [];
  for (const thread of data.user.emailFocus) {
    // Date rows by their latest message in either direction: the default
    // Inbox key would leave out the owner's own replies.
    const item = mapGraphqlSoupItem(thread, { emailView: 'ALL' });
    if (!item || !isDisplayableSoupItem(item)) continue;
    const entity = mapApiSoupItemToEntity(item);
    if (!isEmailEntity(entity) || !thread.focus) continue;
    threads.push({
      ...entity,
      focus: {
        importance: thread.focus.importance,
        needsReply: thread.focus.needsReply,
        needsFollowUp: thread.focus.needsFollowUp,
      },
    });
  }
  return threads;
}

/**
 * The viewer's Focus list, read through the shared GraphQL client. The list is
 * one read the normalized cache can't maintain, so the worker's `focus_updated`
 * push, or a reconnect that may have missed one, reads it again. A hidden tab
 * catches up once when it next shows; a closed tab reads when it opens.
 */
export function useEmailFocusQuery(enabled: Accessor<boolean>) {
  const query = createLiveQuery(
    EmailFocusDocument,
    () => (enabled() ? { days: FOCUS_WINDOW_DAYS } : undefined),
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network' as const,
      select: mapEmailFocus,
    })
  );

  let pushed: TraceContext | undefined;
  const refresh = createVisibleRefresh(
    () => {
      if (!enabled()) return;
      const parent = pushed ?? Telemetry.captureContext();
      pushed = undefined;
      return parent.run(() =>
        Telemetry.span('email.focus.refresh', async (span) => {
          const result = await query.refetch({
            requestPolicy: 'network-only',
            // A query made in a view's flow would otherwise send in that trace.
            context: { [TRACE_PARENT_CONTEXT_KEY]: span },
          });
          span.setAttr('email.focus.threads', result.data?.length ?? 0);
          if (result.error) span.error('Focus refresh failed');
        })
      );
    },
    // The push is best effort, so one lost while hidden must not outlast the tab showing.
    { refreshOnShow: true }
  );
  onCleanup(refresh.dispose);

  createConnectionWebsocketEffect((message) => {
    if (message.type !== 'refresh_email' || !enabled()) return;
    const event = parseWebsocketPayload<RefreshEmailEvent>(
      message.type,
      message.data
    );
    if (event?.event !== 'focus_updated') return;
    if (event.traceparent) pushed = Telemetry.remoteContext(event.traceparent);
    refresh.markDirty();
  });
  const onReconnect = () => {
    if (enabled()) refresh.markDirty();
  };
  ws.addEventListener(WebsocketEvent.Reconnect, onReconnect);
  onCleanup(() =>
    ws.removeEventListener(WebsocketEvent.Reconnect, onReconnect)
  );

  return query;
}
