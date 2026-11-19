// One-off proof, not committed: REST threads against threads assembled by the local read path.
import { readFileSync, writeFileSync } from 'node:fs';
import { ChannelThreadDocument } from '@service-storage/graphql/generated/graphql';
import { print } from 'graphql';
import { expect, it, vi } from 'vitest';
import { normalizeMessageThreadSenders } from '../../message-sender';
import { loadChannelThread } from '../thread';
import { devicePage, fakeHost } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));

const BASE = process.env.LIVE_BASE ?? '';
const COOKIE = BASE ? readFileSync(process.env.LIVE_COOKIE ?? '', 'utf8').trim() : '';
const FX = BASE ? JSON.parse(readFileSync(process.env.LIVE_FIXTURE ?? '', 'utf8')) : {};
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

it.skipIf(!BASE)('REST and locally assembled threads are equal', async () => {
  const report: string[] = [];
  for (const name of ['small', 'medium', 'large']) {
    const channel = FX.channels[name];
    const roots: string[] = [
      channel.threadReply?.rootId,
      ...(channel.biggestThreads ?? []).map((t: { rootId?: string; id?: string }) => t.rootId ?? t.id),
      ...(channel.latestPageThreads ?? []).map((t: { rootId?: string; id?: string }) => t.rootId ?? t.id),
    ].filter(Boolean);
    for (const rootId of [...new Set(roots)].slice(0, 12)) {
      const response = await fetch(`${BASE}/dss/messages/channel/${channel.id}/threads/${rootId}`, { headers: { cookie: COOKIE } });
      if (!response.ok) throw new Error(`REST ${response.status}`);
      const rest = normalizeMessageThreadSenders(await response.json());
      const host = fakeHost(() => devicePage([], { covered: false }));
      let requests = 0;
      const local = await loadChannelThread(host, channel.id, rootId, async (input) => {
        requests += 1;
        const r = await fetch(`${BASE}/dss/items/soup/graphql`, {
          method: 'POST',
          headers: { cookie: COOKIE, 'content-type': 'application/json' },
          body: JSON.stringify({ query: print(ChannelThreadDocument), variables: { input } }),
        });
        const body = await r.json();
        if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 500));
        return body.data.user.channelThread;
      });
      expect(plain(local?.thread), `${name} thread ${rootId}`).toEqual(plain(rest));
      report.push(`${name} thread ${rootId}: ${rest.replies.length} replies equal (${requests} requests)`);
    }
  }
  writeFileSync(process.env.LIVE_REPORT ?? '/dev/null', report.join('\n'));
}, 300_000);
