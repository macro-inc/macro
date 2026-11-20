import { emailToMacroId } from '@core/user/macroId';
import type { PeopleContextUpdate } from '@graphql-cache/people/generated';
import type { Link } from '@service-email/generated/schemas';
import { validate as validUuid } from 'uuid';
import type {
  DirectoryChannel,
  DirectoryParticipant,
} from '../channel/directory-core';
import { canonicalContactUserId } from './contact-user-id';

export type PersonFactPatch = Extract<
  PeopleContextUpdate['action'],
  { kind: 'patch' }
>['updates'][number];
export type PersonFacts = PersonFactPatch['facts'];
export const EMPTY_PERSON_FACTS: Readonly<PersonFacts> = {
  lastInteractionMs: null,
  directMessage: null,
  secondaryInbox: false,
};
const UTF8 = new TextEncoder();

function timestamp(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export type ContextChannel = Pick<
  DirectoryChannel,
  'id' | 'name' | 'channelType' | 'updatedAt' | 'viewedAt'
> & {
  participants: readonly Pick<DirectoryParticipant, 'userId'>[];
  botParticipants: readonly unknown[];
};

/** A command target is a one-to-one DM: the viewer and one other person. */
function commandTarget(channel: ContextChannel, viewer: string | undefined) {
  // A bot in the conversation makes it more than one-to-one.
  if (channel.botParticipants.length > 0) return;
  let other: string | undefined;
  for (const { userId } of channel.participants) {
    if (canonicalContactUserId(userId) === viewer) continue;
    if (other !== undefined) return;
    other = userId;
  }
  const userId =
    other === undefined ? undefined : canonicalContactUserId(other);
  if (!userId || !validUuid(channel.id)) return;
  const name = channel.name ?? '';
  if (UTF8.encode(name).length > 4096) return;
  const timestampMs =
    timestamp(channel.viewedAt) ?? timestamp(channel.updatedAt) ?? 0;
  return { userId, directMessage: { id: channel.id, name, timestampMs } };
}

/** Only channel/inbox metadata, never a contact directory or private contact-name catalog.
 * The map is proportional to existing DM peers/inboxes, not directory membership. */
export function buildContactContextFacts(input: {
  viewer: string;
  channels: readonly ContextChannel[];
  links: readonly Pick<Link, 'email_address' | 'is_primary'>[];
}): ReadonlyMap<string, PersonFacts> {
  const result = new Map<string, PersonFacts>();
  const viewer = canonicalContactUserId(input.viewer);
  for (const channel of input.channels) {
    if (channel.channelType !== 'direct_message') continue;
    // Preserve useDmActivityByUserId's first-other semantics, including
    // group-DM activity; only one-to-one DMs become command targets.
    const firstOther = channel.participants.find(
      (person) => canonicalContactUserId(person.userId) !== viewer
    );
    const peer = firstOther && canonicalContactUserId(firstOther.userId);
    if (!peer) continue;
    const facts: PersonFacts = {
      ...(result.get(peer) ?? EMPTY_PERSON_FACTS),
      lastInteractionMs: timestamp(channel.updatedAt),
    };
    result.set(peer, facts);
    const target = commandTarget(channel, viewer);
    if (!target) continue;
    const commandFacts = result.get(target.userId) ?? EMPTY_PERSON_FACTS;
    const commandTime = target.directMessage.timestampMs;
    const previous = commandFacts.directMessage;
    if (
      previous &&
      (previous.timestampMs > commandTime ||
        (previous.timestampMs === commandTime && previous.id < channel.id))
    )
      continue;
    result.set(target.userId, {
      ...commandFacts,
      directMessage: target.directMessage,
    });
  }
  for (const link of input.links) {
    if (link.is_primary) continue;
    const id = emailToMacroId(link.email_address.toLowerCase());
    const peer = id && canonicalContactUserId(id);
    if (peer)
      result.set(peer, {
        ...(result.get(peer) ?? EMPTY_PERSON_FACTS),
        secondaryInbox: true,
      });
  }
  return result;
}

export function equalPersonFacts(
  a: PersonFacts | undefined,
  b: PersonFacts | undefined
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.lastInteractionMs === b.lastInteractionMs &&
      a.secondaryInbox === b.secondaryInbox &&
      a.directMessage?.id === b.directMessage?.id &&
      a.directMessage?.name === b.directMessage?.name &&
      a.directMessage?.timestampMs === b.directMessage?.timestampMs)
  );
}
