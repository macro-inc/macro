/** One message of a reply idea's thread, as much as a card needs. */
export type ThreadMessage = {
  id: string;
  isDraft: boolean;
  /** Sent by the person. */
  isSent: boolean;
  at: string;
  from?: string;
  text?: string;
};

/** What a reply idea's card says about its thread. */
export type ThreadFacts = {
  /** The drafted reply's text. */
  draftText?: string;
  /** Who wrote last, when it wasn't the person. */
  sender?: string;
  /** When they wrote, while the person hasn't answered since. */
  waitingSince?: string;
};

export function threadFacts(
  messages: ThreadMessage[],
  draftId: string | undefined
): ThreadFacts {
  const draft = messages.find((message) => message.id === draftId);
  const sent = messages
    .filter((message) => !message.isDraft)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const received = sent.filter((message) => !message.isSent);
  const last = sent.at(-1);
  const lastReceived = received.at(-1);

  return {
    draftText: draft?.text?.trim() || undefined,
    sender: lastReceived?.from,
    waitingSince: last && !last.isSent ? last.at : undefined,
  };
}

/** How long someone has waited, in whole hours or days; nothing under an hour. */
export function waitingFor(
  since: string,
  now: Date
): { unit: 'hours' | 'days'; count: number } | undefined {
  const hours = Math.floor((now.getTime() - Date.parse(since)) / 3_600_000);
  if (!(hours >= 1)) return undefined;
  if (hours < 24) return { unit: 'hours', count: hours };

  return { unit: 'days', count: Math.floor(hours / 24) };
}
