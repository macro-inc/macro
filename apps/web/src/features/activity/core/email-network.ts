// Sixteen threads × (five headers + latest message) stays below the API's
// 100-message budget. A full sample never implies no earlier reply exists.
export const EMAIL_HISTORY_LIMIT = 5;

export type EmailContact = {
  email: string;
  name?: string | null;
  picture?: string | null;
};
export type EmailThreadSummary = {
  id: string;
  name?: string | null;
  ownerId: string;
  participants: EmailContact[];
  latestInboundAt?: string | null;
  /** Newest-first headers only, capped at EMAIL_HISTORY_LIMIT. */
  recentMessages?: Array<{
    isSent: boolean;
    isDraft: boolean;
    at?: string | null;
    from?: EmailContact | null;
  }>;
  latest?: {
    isSent: boolean;
    replyingToId?: string | null;
    at?: string | null;
    from?: EmailContact | null;
    to: EmailContact[];
    cc: EmailContact[];
  } | null;
};
export type EmailReplyState =
  | 'unanswered'
  | 'replied'
  | 'team-replied'
  | 'received'
  | 'sent'
  | 'unknown';
export type EmailNetworkPerson = EmailContact & { id: string; role: string };
export type EmailNetworkDetails = {
  people: EmailNetworkPerson[];
  replyState: EmailReplyState;
  latestFrom?: string;
  latestAt?: string | null;
  replyBy?: { id: string; name: string };
};

export function replyStateLabel(state: EmailReplyState): string {
  return {
    unanswered: 'No reply yet',
    replied: 'You replied',
    'team-replied': 'Team replied',
    received: 'Received last',
    sent: 'Sent',
    unknown: 'Reply status unavailable',
  }[state];
}

/** Match only actual email addresses; names and domains never imply membership. */
export function connectEmailParticipants(
  thread: EmailThreadSummary,
  viewerId: string,
  ownEmails: string[],
  knownPeople: string[],
  teamIds: string[] = knownPeople
): EmailNetworkDetails {
  const normalize = (value: string) => value.trim().toLowerCase();
  const own = new Set(
    [...ownEmails, viewerId.replace(/^macro\|/, '')].map(normalize)
  );
  const known = new Map(
    knownPeople
      .filter((id) => id.startsWith('macro|'))
      .map((id) => [normalize(id.slice(6)), id])
  );
  const last = thread.latest;
  const team = new Set(teamIds);
  const messages =
    thread.recentMessages?.filter((message) => !message.isDraft) ?? [];
  const isOurs = (message: (typeof messages)[number]) =>
    (message.isSent && thread.ownerId === viewerId) ||
    own.has(normalize(message.from?.email ?? ''));
  const isTeammate = (message: (typeof messages)[number]) =>
    team.has(known.get(normalize(message.from?.email ?? '')) ?? '');
  const response = messages.find(
    (message, index) =>
      (isOurs(message) || isTeammate(message)) &&
      messages
        .slice(index + 1)
        .some(
          (earlier) =>
            earlier.from?.email &&
            (isOurs(message)
              ? !isOurs(earlier)
              : normalize(earlier.from.email) !==
                normalize(message.from?.email ?? ''))
        )
  );
  const replyBy = response?.from
    ? {
        id: isOurs(response)
          ? viewerId
          : known.get(normalize(response.from.email))!,
        name: isOurs(response)
          ? 'You'
          : response.from.name || response.from.email,
      }
    : undefined;
  const contacts = new Map<string, EmailContact>();
  // Latest headers take precedence over older contact names/photos.
  for (const contact of [
    last?.from,
    ...(last?.to ?? []),
    ...(last?.cc ?? []),
    ...messages.map((message) => message.from),
    ...thread.participants,
  ]) {
    if (!contact?.email) continue;
    const email = normalize(contact.email);
    if (own.has(email)) continue;
    const existing = contacts.get(email);
    contacts.set(email, {
      email,
      name: existing?.name || contact.name,
      picture: existing?.picture || contact.picture,
    });
  }
  const people = [...contacts.values()].map((contact) => ({
    ...contact,
    id: known.get(contact.email) ?? `contact:${contact.email}`,
    role:
      replyBy && replyBy.id === known.get(contact.email)
        ? 'replied'
        : normalize(last?.from?.email ?? '') === contact.email
          ? 'sent'
          : last?.to.some(
                (recipient) => normalize(recipient.email) === contact.email
              )
            ? 'received'
            : last?.cc.some(
                  (recipient) => normalize(recipient.email) === contact.email
                )
              ? "cc'd"
              : 'on thread',
  }));
  let replyState: EmailReplyState = 'unknown';
  if (last && thread.ownerId === viewerId) {
    const outgoing = last.isSent || own.has(normalize(last.from?.email ?? ''));
    replyState = outgoing
      ? thread.latestInboundAt ||
        last.replyingToId ||
        (response && isOurs(response))
        ? 'replied'
        : 'sent'
      : response
        ? isOurs(response)
          ? 'replied'
          : 'team-replied'
        : !thread.recentMessages ||
            thread.recentMessages.length >= EMAIL_HISTORY_LIMIT
          ? 'received'
          : 'unanswered';
  }
  return {
    people,
    replyState,
    latestFrom: last?.from?.name || last?.from?.email,
    latestAt: last?.at,
    replyBy,
  };
}
