import { emailToMacroId } from '@core/user/macroId';
import type { PeopleContextUpdate } from '@graphql-cache/people/generated';
import type { Link } from '@service-email/generated/schemas';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { validate as validUuid } from 'uuid';
import type { CachedGraphqlChannel } from '../channel/graphql';
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
function latest(...values: Array<number | null>): number | null {
  let result: number | null = null;
  for (const value of values)
    if (value !== null && (result === null || value > result)) result = value;
  return result;
}

type ContextChannel = Pick<
  ApiChannelWithLatest,
  'id' | 'name' | 'channel_type' | 'updated_at' | 'viewed_at'
> & {
  participants: readonly Pick<
    ApiChannelWithLatest['participants'][number],
    'user_id'
  >[];
};

/** A command target must still be a one-to-one DM in the newest metadata. */
function commandTarget(
  channel: ContextChannel,
  overlay: CachedGraphqlChannel | undefined,
  activityViewed: number | null,
  viewer: string
) {
  if (overlay && overlay.channelType !== 'direct_message') return;
  let other: string | undefined;
  for (const participant of overlay?.participantIds ?? channel.participants) {
    const id =
      typeof participant === 'string' ? participant : participant.user_id;
    if (id === viewer) continue;
    if (other !== undefined) return;
    other = id;
  }
  const userId =
    other === undefined ? undefined : canonicalContactUserId(other);
  if (!userId || !validUuid(channel.id)) return;
  const name = overlay?.name ?? channel.name ?? '';
  if (UTF8.encode(name).length > 4096) return;
  const viewedAt = latest(
    timestamp(channel.viewed_at),
    timestamp(overlay?.viewedAt),
    activityViewed
  );
  const timestampMs =
    viewedAt ?? timestamp(overlay?.updatedAt ?? channel.updated_at) ?? 0;
  return { userId, directMessage: { id: channel.id, name, timestampMs } };
}

/** Only channel/inbox metadata, never a contact directory or private contact-name catalog.
 * The map is proportional to existing DM peers/inboxes, not directory membership. */
export function buildContactContextFacts(input: {
  viewer: string;
  channels: readonly ContextChannel[];
  activity: readonly Pick<ApiActivity, 'channel_id' | 'viewed_at'>[];
  links: readonly Pick<Link, 'email_address' | 'is_primary'>[];
  cachedChannels: readonly CachedGraphqlChannel[];
}): ReadonlyMap<string, PersonFacts> {
  const result = new Map<string, PersonFacts>();
  const viewed = new Map(
    input.activity.map((row) => [row.channel_id, timestamp(row.viewed_at)])
  );
  const cached = new Map(
    input.cachedChannels.map((channel) => [channel.id, channel])
  );
  for (const channel of input.channels) {
    if (channel.channel_type !== 'direct_message') continue;
    // Preserve useDmActivityByUserId's source-order/first-other semantics,
    // including group-DM activity; only one-to-one DMs become command targets.
    const firstOther = channel.participants.find(
      (person) => person.user_id !== input.viewer
    );
    const peer = firstOther && canonicalContactUserId(firstOther.user_id);
    if (!peer) continue;
    const facts: PersonFacts = {
      ...(result.get(peer) ?? EMPTY_PERSON_FACTS),
      lastInteractionMs: timestamp(channel.updated_at),
    };
    result.set(peer, facts);
    const target = commandTarget(
      channel,
      cached.get(channel.id),
      viewed.get(channel.id) ?? null,
      input.viewer
    );
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
