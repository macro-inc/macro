import { PEOPLE_POLICY_VERSION } from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { ContactWindowHost } from '@queries/contacts/directory-query';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { createSignal } from 'solid-js';

/**
 * Stand-ins for the Share field's recipient source at an account's real scale:
 * every channel the account is in (`useChannelsContext`) and a local contact
 * cache that answers ranked people searches after a set delay. Sizes come from
 * the page URL: `groups`, `dms`, `people`, `latency` (milliseconds). The data
 * is built on first use, so other fixtures in this bundle never pay for it.
 */

const VIEWER = 'macro|viewer@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000002';
const DAY_MS = 86_400_000;

// A fixed seed, so every run lists the same names in the same order.
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const FIRST_NAMES =
  'Sarah James Maria David Aisha Wei Olivia Liam Sofia Noah Emma Lucas Mia Ethan Ava Mateo Chloe Daniel Grace Samuel Nora Henry Zoe Jack Lily Owen Hannah Leo Ella Isaac Priya Ravi Yuki Kenji Fatima Omar Elena Ivan Camila Diego Anna Peter Julia Marco Laura Tom Rachel Ben Teresa Victor'.split(
    ' '
  );
const LAST_NAMES =
  'Smith Johnson Garcia Chen Patel Kim Nguyen Brown Martinez Lee Walker Hall Young King Wright Lopez Hill Scott Green Adams Baker Nelson Carter Mitchell Perez Roberts Turner Phillips Campbell Parker Evans Edwards Collins Stewart Sanchez Morris Rogers Reed Cook Morgan Bell Murphy Bailey Rivera Cooper'.split(
    ' '
  );
const WORDS =
  'design launch growth billing infra mobile sales support hiring roadmap marketing ops finance legal research partners onboarding release security data platform brand events customers product quality docs'.split(
    ' '
  );
const DOMAINS = ['example.com', 'acme.io', 'globex.com', 'initech.co'];

type Person = { id: string; email: string; name: string; recentMs: number };
type World = {
  people: Person[];
  channels: ApiChannelWithLatest[];
  latencyMs: number;
};

function createWorld(): World {
  const params = new URLSearchParams(location.search);
  const groupCount = Number(params.get('groups') ?? 2_000);
  const dmCount = Number(params.get('dms') ?? 500);
  const peopleCount = Number(params.get('people') ?? 5_000);
  const random = createRandom(7);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)];
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const people: Person[] = Array.from({ length: peopleCount }, (_, index) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const email = `${first}.${last}${index}@${pick(DOMAINS)}`.toLowerCase();
    return {
      id: `macro|${email}`,
      email,
      name: `${first} ${last}`,
      recentMs: now - Math.floor(random() * 90 * DAY_MS),
    };
  });

  const channel = (
    index: number,
    name: string,
    channelType: ApiChannelWithLatest['channel_type'],
    participants: string[]
  ): ApiChannelWithLatest => {
    const updated = now - Math.floor(random() * 120 * DAY_MS);
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    return {
      id,
      name,
      channel_type: channelType,
      created_at: iso(updated - DAY_MS),
      updated_at: iso(updated),
      viewed_at: random() < 0.5 ? iso(updated) : null,
      interacted_at: random() < 0.5 ? iso(updated) : null,
      owner_id: VIEWER,
      auto_join_team: false,
      is_participant: true,
      participants: participants.map((user_id) => ({
        channel_id: id,
        user_id,
        role: 'member',
        joined_at: iso(updated - DAY_MS),
      })),
    };
  };

  // Half the groups are named channels; the rest are group DMs named after
  // their people, as the app names them. One-to-one DMs never list as groups.
  const channels = [
    ...Array.from({ length: groupCount }, (_, index) => {
      const members = Array.from({ length: 3 + Math.floor(random() * 4) }, () =>
        pick(people)
      );
      const name =
        index % 2 === 0
          ? `${pick(WORDS)}-${pick(WORDS)}${index % 7 === 0 ? ` ${index}` : ''}`
          : members.map((person) => person.name).join(', ');
      return channel(
        index,
        name,
        index % 2 === 0 ? 'private' : 'direct_message',
        [VIEWER, ...members.map((person) => person.id)]
      );
    }),
    ...Array.from({ length: dmCount }, (_, index) => {
      const person = pick(people);
      return channel(groupCount + index, person.name, 'direct_message', [
        VIEWER,
        person.id,
      ]);
    }),
  ];

  localStorage.setItem(
    `graphql-contacts-backfill:v2:${VIEWER}`,
    JSON.stringify({
      userId: VIEWER,
      storageGeneration: GENERATION,
      nextCursor: null,
      pages: 200,
      phase: 'verify',
      verificationIncomplete: false,
      completedAt: now,
    })
  );
  return {
    people,
    channels,
    latencyMs: Number(params.get('latency') ?? 60),
  };
}

let current: World | undefined;
const world = () => {
  current ??= createWorld();
  return current;
};

export const useChannelsContext = () => {
  const [channels] = createSignal(world().channels);
  return { channels };
};

export const useIsConnectedSecondaryInbox = () => () => false;

const [reads, setReads] = createSignal(0);
/** Contact reads started and not yet answered. */
const [pendingReads, setPendingReads] = createSignal(0);

export { pendingReads, reads };

/** Ranked like the cache: names starting with the query, then other names or
 * addresses containing it, most recent first in each group. */
function search(query: string, after: number, limit: number) {
  const term = query.trim().toLowerCase();
  const rank = (person: Person) => {
    if (!term) return 1;
    const name = person.name.toLowerCase();
    if (name.startsWith(term) || name.includes(` ${term}`)) return 2;
    if (name.includes(term) || person.email.includes(term)) return 1;
    return 0;
  };
  const matches = world()
    .people.flatMap((person) => {
      const value = rank(person);
      return value ? [{ person, value }] : [];
    })
    .sort((a, b) => b.value - a.value || b.person.recentMs - a.person.recentMs);
  return {
    page: matches.slice(after, after + limit).map(({ person }) => person),
    next: after + limit < matches.length ? String(after + limit) : null,
  };
}

const HOST: ContactWindowHost = {
  clientId: 'share-fixture',
  currentStorageGeneration: async () => GENERATION,
  readQuery: async () => ({ kind: 'hit', data: { user: { id: VIEWER } } }),
  people: {
    ...unsupportedContactSync,
    readSql: async () => ({ kind: 'unsupported' }),
    resolveReferences: async () => ({ kind: 'unsupported' }),
    context: async () => ({ kind: 'unsupported' }),
    update: async () => {
      throw new Error('Fixture has no publisher');
    },
    search: async (request) => {
      setReads((value) => value + 1);
      setPendingReads((value) => value + 1);
      await new Promise((resolve) => setTimeout(resolve, world().latencyMs));
      setPendingReads((value) => value - 1);
      const { page, next } = search(
        request.query,
        request.cursor ? Number(request.cursor) : 0,
        request.limit
      );
      return {
        kind: 'page',
        policyVersion: PEOPLE_POLICY_VERSION,
        people: page.map((person) => ({
          recordKey: `GraphqlContact:${person.id}`,
          userId: person.id,
          email: person.email,
          name: person.name,
          matchRank: 0,
          score: 0,
          timestampMs: person.recentMs,
          directMessage: null,
          lastInteractionMs: person.recentMs,
        })),
        truncated: !!next,
        nextCursor: next,
      };
    },
  },
  readRecordsByKeys: async () => ({
    revision: INITIAL_CACHE_REVISION,
    records: [],
  }),
  onCacheChanged: () => () => {},
  onCacheGenerationChanged: () => () => {},
};

export const useContactDirectoryScope = () => {
  world();
  return () => ({ userId: VIEWER, host: HOST });
};
