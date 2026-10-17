/**
 * Which inbox an AI-drafted email goes out from.
 *
 * The agent writes recipients and prose; the inbox has to be worked out. The
 * card cannot guess, because the sender is what the recipient sees and
 * replies to — so the From row it shows has to be the inbox the send will
 * really use. The last three cases below are the order the backend resolves
 * in (`resolve_sending_inbox` in the email domain), which is what keeps the
 * two in agreement for a draft that names no sender.
 */

export type SelectableInbox = {
  id: string;
  email_address: string;
};

export type SendingInboxChoice = {
  /** The inbox the user picked in this card, if they picked one. */
  chosenInboxId?: string;
  /** The sender the draft names, as an address. */
  draftFrom?: string | null;
  /** The inbox holding the message this draft replies to. */
  replyTargetInboxId?: string;
  /** The viewer's own primary inbox. */
  primaryInboxId?: string;
};

/**
 * The inbox to send from, in precedence order: the user's own pick, the
 * sender the draft names, the inbox that received the message being replied
 * to, the viewer's primary inbox, then whatever is connected. `undefined`
 * only when nothing is.
 */
export function resolveSendingInbox<T extends SelectableInbox>(
  inboxes: readonly T[],
  choice: SendingInboxChoice
): T | undefined {
  const byId = (id: string | undefined) =>
    id === undefined ? undefined : inboxes.find((inbox) => inbox.id === id);
  // Addresses compare case-insensitively, the way mail domains treat them,
  // and a blank `from` is no choice at all rather than an inbox called
  // nothing.
  const named = choice.draftFrom?.trim().toLowerCase();
  const byAddress = named
    ? inboxes.find((inbox) => inbox.email_address.toLowerCase() === named)
    : undefined;

  return (
    byId(choice.chosenInboxId) ??
    byAddress ??
    byId(choice.replyTargetInboxId) ??
    byId(choice.primaryInboxId) ??
    inboxes[0]
  );
}
