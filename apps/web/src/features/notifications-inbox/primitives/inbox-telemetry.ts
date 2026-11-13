import { type Span, Telemetry } from '@macro-inc/observability';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import type { InboxClear } from '../core/inbox-filters';

/**
 * Run an operation on inbox rows in its own span, recording the rows by their
 * opaque ids and types, never their content, and whether it succeeded.
 */
export function traceInboxRows<T>(
  name: string,
  rows: readonly NotificationInboxRow[],
  operation: (span: Span) => Promise<T>
): Promise<T> {
  return Telemetry.span(name, async (span) => {
    span.setAttr('inbox.rows', rows.length);
    span.setAttr(
      'inbox.row_types',
      [...new Set(rows.map((row) => row.type))].join(',')
    );
    const [row] = rows;
    if (row && rows.length === 1) span.setAttr('inbox.row_id', row.id);
    try {
      const result = await operation(span);
      span.setAttr('inbox.outcome', 'succeeded');
      return result;
    } catch (error) {
      span.setAttr('inbox.outcome', 'failed');
      // Server messages can quote names; record only which step failed.
      span.error(`${name} failed`);
      throw error;
    }
  });
}

/**
 * Run a clear in its own span, recording what it takes (lane, kinds, unread
 * only, since a time) and how many rows it cleared, never their content.
 */
export function traceInboxClear<T extends { count: number }>(
  clear: InboxClear,
  operation: () => Promise<T>
): Promise<T> {
  return Telemetry.span('notifications_inbox.clear', async (span) => {
    span.setAttr('inbox.clear_lane', clear.lane);
    span.setAttr('inbox.clear_row_types', clear.rowTypes.join(','));
    span.setAttr('inbox.clear_unread_only', clear.unreadOnly);
    span.setAttr('inbox.clear_since', clear.since !== undefined);
    try {
      const result = await operation();
      span.setAttr('inbox.rows', result.count);
      span.setAttr('inbox.outcome', 'succeeded');
      return result;
    } catch (error) {
      span.setAttr('inbox.outcome', 'failed');
      span.error('notifications_inbox.clear failed');
      throw error;
    }
  });
}
