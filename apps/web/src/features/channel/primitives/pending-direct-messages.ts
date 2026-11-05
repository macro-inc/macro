/**
 * DMs that don't exist yet. Opening a person you have no DM with shows the
 * conversation under a temporary channel id, and its first message creates
 * the real DM, which then takes its place. Until then nothing exists on the
 * server, so neither person's DM list shows it.
 *
 * The temporary id maps to the person only in this tab's memory, so links and
 * page views never carry their email. An id this tab doesn't know (a reload,
 * a restored layout) opens nothing.
 */
const PENDING_DIRECT_MESSAGE_PREFIX = 'pending-dm-';

const recipientsById = new Map<string, string>();
const idsByRecipient = new Map<string, string>();

export function isPendingDirectMessageId(id: string | undefined): boolean {
  return !!id?.startsWith(PENDING_DIRECT_MESSAGE_PREFIX);
}

/** The temporary channel id for a DM with `recipientId`, reused until it's created. */
export function pendingDirectMessageId(recipientId: string): string {
  const existing = idsByRecipient.get(recipientId);
  if (existing) return existing;
  const id = `${PENDING_DIRECT_MESSAGE_PREFIX}${crypto.randomUUID()}`;
  recipientsById.set(id, recipientId);
  idsByRecipient.set(recipientId, id);
  return id;
}

/** The person a temporary channel id stands for, if this tab opened it. */
export function pendingDirectMessageRecipient(
  id: string | undefined
): string | undefined {
  return id ? recipientsById.get(id) : undefined;
}

/** Drop a temporary id once its DM exists, so the next open finds the real one. */
export function settlePendingDirectMessage(id: string): void {
  const recipientId = recipientsById.get(id);
  recipientsById.delete(id);
  if (recipientId && idsByRecipient.get(recipientId) === id)
    idsByRecipient.delete(recipientId);
}
