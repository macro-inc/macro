import type { Span } from '@macro-inc/observability';
import type { UnifiedNotification } from '@notifications/types';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  InboxRequest,
  InboxRequests,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import {
  type InboxDecision,
  type InboxDecisionAction,
  type InboxRowAction,
  isDecisionAction,
} from '../core/inbox-row';
import { traceInboxRows } from './inbox-telemetry';

/** The request a notification asks the viewer to decide, if any. */
const requestIn = (
  notification: UnifiedNotification
): InboxRequest | undefined =>
  match(notification.notification_metadata)
    .returnType<InboxRequest | undefined>()
    .with({ tag: 'entity_access_requested' }, (metadata) => ({
      kind: 'access_request',
      entityType: notification.entity_type,
      entityId: notification.entity_id,
      requestId: metadata.content.requestId,
      revision: metadata.content.revision,
      level: metadata.content.accessLevel,
    }))
    .with({ tag: 'calendar_event_join_request' }, (metadata) => ({
      kind: 'join_request',
      requestId: metadata.content.requestId,
      eventId: metadata.content.eventId,
    }))
    .otherwise(() => undefined);

const decides = (request: InboxRequest, decision: InboxDecision) =>
  match(request.kind)
    .with('access_request', () => decision === 'approve' || decision === 'deny')
    .with('join_request', () => decision === 'accept' || decision === 'decline')
    .exhaustive();

/**
 * The request a decision resolves, read from the row's notification that
 * carries it; undefined when the row doesn't show that request.
 */
export const decisionRequest = (
  row: NotificationInboxRow,
  action: InboxDecisionAction
): InboxRequest | undefined =>
  row.content.notifications
    .map(requestIn)
    .find(
      (request) =>
        request?.requestId === action.targetId && decides(request, action.kind)
    );

/** The row's actions this build can carry out, in button order. */
export const rowButtons = (row: NotificationInboxRow): InboxRowAction[] =>
  row.actions.filter(
    (action) =>
      !isDecisionAction(action) || decisionRequest(row, action) !== undefined
  );

/** Record the ids a request is searched by. */
const traceRequest = (span: Span, request: InboxRequest) =>
  match(request)
    .with({ kind: 'access_request' }, (access) => {
      span.setAttr('access_request.id', access.requestId);
      span.setAttr('entity.type', access.entityType);
      span.setAttr('entity.id', access.entityId);
    })
    .with({ kind: 'join_request' }, (join) => {
      span.setAttr('calendar_join_request.id', join.requestId);
      span.setAttr('calendar.event_id', join.eventId);
    })
    .exhaustive();

export type InboxRowActionNotices = {
  succeeded: (decision: InboxDecision) => void;
  failed: (decision: InboxDecision) => void;
};

/**
 * Runs a row's buttons. Open and Answer open the row, Review opens the pull
 * request. A decision runs one at a time per row, then completes the row,
 * which the decision resolved; a failed decision leaves the row as it was.
 */
export function createRowActions(options: {
  requests: InboxRequests;
  /** Open what a row is about, as activating the row does. */
  open: (row: NotificationInboxRow) => void;
  /** Open a pull request to review outside Macro. */
  review: (row: NotificationInboxRow, url: string) => void;
  complete: (row: NotificationInboxRow) => Promise<unknown>;
  notices: InboxRowActionNotices;
}) {
  const [pending, setPending] = createSignal<
    ReadonlyMap<string, InboxDecision>
  >(new Map());
  const setRowPending = (rowId: string, decision: InboxDecision | undefined) =>
    setPending((current) => {
      const next = new Map(current);
      if (decision) next.set(rowId, decision);
      else next.delete(rowId);
      return next;
    });

  const send = (request: InboxRequest, decision: InboxDecision) =>
    match(request)
      .with({ kind: 'access_request' }, (access) =>
        options.requests.resolveAccessRequest(access, decision === 'approve')
      )
      .with({ kind: 'join_request' }, (join) =>
        options.requests.answerJoinRequest(join, decision === 'accept')
      )
      .exhaustive();

  const complete = async (row: NotificationInboxRow) => {
    try {
      await traceInboxRows('notifications_inbox.row_done', [row], () =>
        options.complete(row)
      );
    } catch {
      // The decision stands; the row leaves when the server's change lands.
    }
  };

  const decide = async (
    row: NotificationInboxRow,
    action: InboxDecisionAction
  ) => {
    const request = decisionRequest(row, action);
    if (!request || pending().has(row.id)) return;
    setRowPending(row.id, action.kind);
    try {
      await traceInboxRows(
        'notifications_inbox.row_answer',
        [row],
        async (span) => {
          span.setAttr('inbox.row_type', row.type);
          span.setAttr('inbox.answer', action.kind);
          traceRequest(span, request);
          await send(request, action.kind);
          options.notices.succeeded(action.kind);
          await complete(row);
        }
      );
    } catch {
      options.notices.failed(action.kind);
    }
    setRowPending(row.id, undefined);
  };

  const run = async (row: NotificationInboxRow, action: InboxRowAction) => {
    if (isDecisionAction(action)) return decide(row, action);
    match(action)
      .with({ kind: 'open' }, { kind: 'answer' }, () => options.open(row))
      .with({ kind: 'review' }, ({ url }) => options.review(row, url))
      .exhaustive();
  };

  return {
    /** The decision in flight for a row, if any. */
    pending: (rowId: string) => pending().get(rowId),
    run,
  };
}
