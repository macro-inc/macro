/**
 * Concurrent load on the same stack while a run compares: REST and GraphQL
 * Soup reads, history views, document creates and renames, channel messages.
 * It acts as the users of a world of its own, so it changes nothing the
 * compared worlds read; it only competes for the services and the database.
 */
import type { ApiUser } from './api';
import type { Rng } from './rng';
import type { World } from './world';

const SOUP = `query Soup($input: SoupInput!) {
  user { id soup(input: $input) { nextCursor items { __typename id } } }
}`;

export type LoadStats = { ops: Record<string, number>; errors: Record<string, number>; startedAt: number; stoppedAt?: number };

export function startLoad(args: { world: World; rng: Rng; concurrency: number }): { stop: () => Promise<LoadStats> } {
  const { world, rng, concurrency } = args;
  const stats: LoadStats = { ops: {}, errors: {}, startedAt: Date.now() };
  let running = true;
  const users: ApiUser[] = [world.users.owner, world.users.member, world.users.boundary].filter(Boolean);
  const docs = world.entities.filter((e) => e.kind === 'md' && e.owner === 'owner' && !e.deleted).map((e) => e.id);
  const ops: [number, string, (u: ApiUser, i: number) => Promise<unknown>][] = [
    [30, 'rest.soup', (u) => u.get('/dss/items/soup?limit=100')],
    [30, 'graphql.soup', (u) => u.graphql(SOUP, { input: { initial: { limit: 100 } } })],
    [15, 'history.view', () => world.users.owner.post(`/dss/history/document/${rng.pick(docs)}`)],
    [8, 'doc.create', (u, i) => u.post('/dss/documents/create_markdown', { documentName: `Load ${i}`, markdown: 'load', skipHistory: true })],
    [8, 'doc.rename', (_u, i) => world.users.owner.patch(`/dss/documents/${rng.pick(docs)}`, { documentName: `Load renamed ${i}` })],
    [9, 'channel.message', (_u, i) => world.users.member.post(`/dss/messages/channel/${world.channelId}`, { content: `load ${i}` })],
  ];
  let n = 0;
  const worker = async () => {
    while (running) {
      const [, name, op] = rng.weighted(ops.map((o) => [o[0], o] as [number, typeof o]));
      const i = n++;
      try {
        await op(rng.pick(users), i);
        stats.ops[name] = (stats.ops[name] ?? 0) + 1;
      } catch (error) {
        const key = `${name}: ${String(error).slice(0, 80)}`;
        stats.errors[key] = (stats.errors[key] ?? 0) + 1;
      }
    }
  };
  const workers = Array.from({ length: concurrency }, worker);
  return {
    stop: async () => {
      running = false;
      await Promise.allSettled(workers);
      stats.stoppedAt = Date.now();
      return stats;
    },
  };
}
