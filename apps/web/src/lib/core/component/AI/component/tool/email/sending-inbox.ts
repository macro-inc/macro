/**
 * Which inbox an AI-drafted email goes out from.
 *
 * The agent writes recipients and prose; the inbox has to be worked out. The
 * card cannot guess, because the sender is what the recipient sees and
 * replies to — so the From row it shows has to be the inbox the send will
 * really use. Unavailable explicit choices and unresolved replies never fall
 * back to another inbox.
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
  /** A reply cannot default to the primary inbox before its target resolves. */
  isReply?: boolean;
  /** The viewer's own primary inbox. */
  primaryInboxId?: string;
};

/**
 * The inbox to send from, in precedence order: the user's own pick, the
 * sender the draft names, the inbox that received the message being replied
 * to, then the viewer's default inbox for a new email. `undefined` means the
 * sender is unresolved or unavailable and sending must wait for a choice.
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

  if (choice.chosenInboxId !== undefined) return byId(choice.chosenInboxId);
  if (named) return byAddress;
  if (choice.isReply || choice.replyTargetInboxId !== undefined) {
    return byId(choice.replyTargetInboxId);
  }
  return byId(choice.primaryInboxId) ?? inboxes[0];
}
