// One-off proof, not committed: REST timeline pages against GraphQL pages mapped
// through the local read path, on a running stack.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ChannelTimelineDocument,
  type ChannelTimelineQuery,
} from '@service-storage/graphql/generated/graphql';
import { print } from 'graphql';
import { expect, it } from 'vitest';
import { normalizeMessageTimelinePageSenders } from '../../message-sender';
import { mapChannelTimelineEntry } from '../map';
import { cursorFromSortKey } from '../sort-key';

const BASE = process.env.LIVE_BASE ?? '';
const COOKIE = BASE ? readFileSync(process.env.LIVE_COOKIE ?? '', 'utf8').trim() : '';
const FX = BASE ? JSON.parse(readFileSync(process.env.LIVE_FIXTURE ?? '', 'utf8')) : {};
const ENV = BASE ? JSON.parse(readFileSync(process.env.LIVE_ENV ?? '', 'utf8')) : {};
const MAX_PAGES = Number(process.env.LIVE_PAGES ?? 12);

type Page = ChannelTimelineQuery['user']['channelTimeline'];

async function rest(channelId: string, selection: Record<string, unknown>) {
  const url = `${BASE}/dss/messages/channel/${channelId}/timeline?selection=${encodeURIComponent(JSON.stringify(selection))}`;
  const response = await fetch(url, { headers: { cookie: COOKIE } });
  if (!response.ok) throw new Error(`REST ${response.status}`);
  return normalizeMessageTimelinePageSenders(await response.json());
}

async function gql(input: Record<string, unknown>): Promise<Page> {
  const response = await fetch(`${BASE}/dss/items/soup/graphql`, {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify({ query: print(ChannelTimelineDocument), variables: { input } }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 500));
  return body.data.user.channelTimeline;
}

const mapped = (page: Page) => ({
  entries: page.entries.flatMap((entry) => mapChannelTimelineEntry(entry) ?? []),
  next_cursor: page.olderCursor === null ? null : cursorFromSortKey(page.olderCursor),
  previous_cursor: page.newerCursor === null ? null : cursorFromSortKey(page.newerCursor),
});

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const report: string[] = [];

it.skipIf(!BASE)('REST and GraphQL pages are equal row for row', async () => {
  const channels: Record<string, string> = ENV.channels;
  for (const [name, channelId] of Object.entries(channels)) {
    let restPage = await rest(channelId, { limit: 50, direction: 'older', around: null, include_deleted_threads: false });
    let gqlPage = await gql({ channelId, limit: 50 });
    let rows = 0;
    let pages = 0;
    for (;;) {
      pages += 1;
      rows += restPage.entries.length;
      expect(plain(mapped(gqlPage)), `${name} page ${pages}`).toEqual(plain(restPage));
      if (!restPage.next_cursor || pages >= MAX_PAGES) break;
      restPage = await rest(channelId, { limit: 100, cursor: restPage.next_cursor, direction: 'older', around: null, include_deleted_threads: false });
      gqlPage = await gql({ channelId, limit: 100, before: gqlPage.olderCursor });
    }
    report.push(`${name}: ${pages} pages, ${rows} rows equal`);
  }
  for (const name of ['medium', 'large']) {
    const channel = FX.channels[name];
    for (const target of [channel.oldRoot.id, channel.threadReply.replyId]) {
      const restPage = await rest(channel.id, { limit: 50, direction: 'older', around: target, include_deleted_threads: false });
      const gqlPage = await gql({ channelId: channel.id, limit: 50, around: target });
      expect(plain(mapped(gqlPage)), `${name} around ${target}`).toEqual(plain(restPage));
      report.push(`${name} around ${target}: ${restPage.entries.length} rows equal`);
      // Newer from the window, as scrolling down after a jump does.
      if (restPage.previous_cursor) {
        const restNewer = await rest(channel.id, { limit: 100, cursor: restPage.previous_cursor, direction: 'newer', around: null, include_deleted_threads: false });
        const gqlNewer = await gql({ channelId: channel.id, limit: 100, after: gqlPage.newerCursor });
        expect(plain(mapped(gqlNewer)), `${name} newer after ${target}`).toEqual(plain(restNewer));
        report.push(`${name} newer after ${target}: ${restNewer.entries.length} rows equal`);
      }
    }
  }
  writeFileSync(process.env.LIVE_REPORT ?? '/dev/null', report.join('\n'));
}, 300_000);
