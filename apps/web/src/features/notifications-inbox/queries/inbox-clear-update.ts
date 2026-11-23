import { z } from 'zod';

/** The gateway message the server sends when one of the viewer's clears changes. */
export const INBOX_CLEAR_UPDATED = 'notification_inbox_clear_updated';

const updateSchema = z.object({ clearId: z.string().uuid() });

/**
 * The clear a gateway hint names. The hint carries no more than that: the
 * clear itself is read from the server, which is the only record of it.
 */
export function parseInboxClearUpdate(payload: unknown): string | undefined {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const parsed = updateSchema.safeParse(data);
  return parsed.success ? parsed.data.clearId : undefined;
}
