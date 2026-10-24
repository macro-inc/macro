import { type Span, Telemetry } from '@macro-inc/observability';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

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
