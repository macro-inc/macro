import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  FromPeer,
  FromRemote,
  type IFromRemote,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import { test as base, expect, type Page } from '@playwright/test';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  intoFrames,
  Reassembler,
} from '../../../../../../../../../packages/collaboration/src/websocket/platform/framing';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/collaboration/browser-test/sync-banner.html';

/** Matches SYNC_PROBLEM_DELAY_MS: how long a problem lasts before the banner. */
const DELAY_MS = 10_000;

/**
 * A sync-service room. A `stalled` peer stays connected but its updates are
 * dropped unanswered, as when the server accepts the socket but never gets the
 * edits to the document. An `offline` peer's socket is refused. A `withheld`
 * peer's socket opens, but the document's initial sync waits for `release`.
 */
async function startRoom() {
  const doc = new LoroDoc();
  let seeded = false;
  const http = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method !== 'POST' || request.url !== '/seed') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(chunk);
    if (!seeded) {
      doc.import(Buffer.concat(chunks));
      seeded = true;
    }
    response.writeHead(204).end();
  });
  const offline = new Set<string>();
  // An offline peer's handshake is refused, as when the server can't reach
  // the document ("Expected 101 status code"), so its socket never opens.
  const server = new WebSocketServer({
    server: http,
    verifyClient: ({ req }, done) =>
      done(!offline.has(req.url?.slice(1) ?? ''), 503),
  });
  http.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No room port');
  const peers = new Map<string, WebSocket>();
  const stalled = new Set<string>();
  const withheld = new Map<string, () => void>();
  const id = randomUUID();
  const send = (peer: WebSocket, message: IFromRemote) => {
    for (const frame of intoFrames(FromRemote.encode(message)))
      peer.send(frame);
  };

  server.on('connection', (socket, request) => {
    const name = request.url?.slice(1);
    if (!name) throw new Error('Missing peer name');
    peers.set(name, socket);
    socket.on('close', () => {
      if (peers.get(name) === socket) peers.delete(name);
    });
    const receiver = new Reassembler();
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        if (data.toString() === 'ping') socket.send('pong');
        return;
      }
      if (!Buffer.isBuffer(data)) throw new Error('Expected a binary frame');
      const frame = receiver.push(data);
      if (!frame) return;
      const message = FromPeer.decode(frame);
      if (message.isPeerUpdate()) {
        if (stalled.has(name)) return;
        const before = doc.oplogVersion();
        doc.importBatch(message.value.updates);
        const update = doc.export({ mode: 'update', from: before });
        for (const [otherName, other] of peers) {
          if (otherName !== name)
            send(other, FromRemote.fromRemoteUpdate({ update }));
        }
        send(socket, FromRemote.fromRemoteUpdateAck({ id: message.value.id }));
      } else if (message.isPeerRequestSince()) {
        const vv = message.value.vv;
        const from = VersionVector.decode(vv);
        try {
          const update = doc.export({ mode: 'update', from });
          send(socket, FromRemote.fromRemoteUpdateSince({ vv, update }));
        } finally {
          from.free();
        }
      } else if (message.isPeerRequestSnapshot()) {
        send(
          socket,
          FromRemote.fromRemoteSnapshot({
            snapshot: doc.export({ mode: 'snapshot' }),
          })
        );
      }
    });
    const initialSync = () =>
      send(
        socket,
        FromRemote.fromRemoteInitialSync({
          snapshot: doc.export({ mode: 'snapshot' }),
          awareness: new Uint8Array(),
        })
      );
    if (withheld.has(name)) withheld.set(name, initialSync);
    else initialSync();
  });

  return {
    url(peer: string, theme: 'light' | 'dark' = 'dark') {
      return `${fixture}?id=${id}&port=${address.port}&peer=${peer}&theme=${theme}`;
    },
    stall(peer: string) {
      stalled.add(peer);
    },
    unstall(peer: string) {
      stalled.delete(peer);
    },
    disconnect(peer: string) {
      offline.add(peer);
      peers.get(peer)?.close(1012, 'fixture offline');
    },
    reconnect(peer: string) {
      offline.delete(peer);
    },
    withhold(peer: string) {
      withheld.set(peer, () => {});
    },
    release(peer: string) {
      const initialSync = withheld.get(peer);
      withheld.delete(peer);
      initialSync?.();
    },
    async close() {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      doc.free();
    },
  };
}

const test = base.extend<{ room: Awaited<ReturnType<typeof startRoom>> }>({
  room: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error('Fixture origin is required');
    const room = await startRoom();
    try {
      await use(room);
    } finally {
      await room.close();
    }
  },
});

async function openEditor(page: Page, url: string) {
  page.on('pageerror', (error) => console.error('Fixture page error', error));
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.routeWebSocket(
    (socketUrl) => socketUrl.hostname !== '127.0.0.1',
    (socket) => socket.close()
  );
  await page.goto(url);
  // Two editors compile and sync at once; the first load can be slow.
  await expect(
    page.locator('[role="textbox"][contenteditable="true"]')
  ).toBeVisible({ timeout: 60_000 });
  await page.clock.install();
}

async function typeAtEnd(page: Page, text: string) {
  await page.evaluate(() => window.syncBannerFixture?.placeAtEnd());
  await page.keyboard.insertText(text);
}

const pendingWrites = (page: Page) =>
  page.evaluate(() => window.syncBannerFixture?.pendingWrites());

const banner = (page: Page) => page.locator('[data-sync-problem]');

test('edits the server never acknowledges raise a banner that clears once they are delivered', async ({
  page,
  browser,
  room,
  isMobile,
  viewport,
}) => {
  const second = await browser.newContext({
    isMobile,
    hasTouch: isMobile,
    viewport,
  });
  try {
    const other = await second.newPage();
    await Promise.all([
      openEditor(page, room.url('writer', 'light')),
      openEditor(other, room.url('reader', 'light')),
    ]);

    // A healthy session types for longer than the delay without a banner.
    for (const word of [' one', ' two', ' three']) {
      await typeAtEnd(page, word);
      await page.clock.runFor(DELAY_MS / 2);
    }
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph one two three'
    );
    await expect.poll(() => pendingWrites(page)).toBe(0);
    await expect(banner(page)).toHaveCount(0);

    // The socket stays open, but the server stops taking the writer's edits.
    room.stall('writer');
    await typeAtEnd(page, ' lost');
    await expect.poll(() => pendingWrites(page)).toBeGreaterThan(0);
    await page.clock.runFor(DELAY_MS - 1_000);
    await expect(banner(page)).toHaveCount(0);
    await page.clock.runFor(1_500);
    await expect(banner(page)).toHaveAttribute('data-sync-problem', 'unsaved');
    await expect(page.getByRole('alert')).toContainText('Changes not saved');
    await expect(other.getByRole('textbox')).not.toContainText('lost');
    await page.screenshot({
      path: test.info().outputPath('unsaved-banner.png'),
    });

    // The server recovers; Retry resends at once and the banner goes away.
    room.unstall('writer');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph one two three lost'
    );
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => pendingWrites(page)).toBe(0);
    await page.clock.runFor(DELAY_MS * 2);
    await expect(banner(page)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('delivered.png') });
  } finally {
    await second.close();
  }
});

test('a lost connection raises an offline banner, then an unsaved one once edits wait, and both clear on reconnect', async ({
  page,
  browser,
  room,
}) => {
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await Promise.all([
      openEditor(page, room.url('writer')),
      openEditor(other, room.url('reader')),
    ]);

    room.disconnect('writer');
    await page.clock.runFor(DELAY_MS + 1_000);
    await expect(banner(page)).toHaveAttribute('data-sync-problem', 'offline');
    await expect(banner(page)).toContainText('Not connected');
    await expect(banner(other)).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath('offline-banner.png'),
    });

    await typeAtEnd(page, ' offline edit');
    await page.clock.runFor(DELAY_MS + 1_000);
    await expect(banner(page)).toHaveAttribute('data-sync-problem', 'unsaved');
    await page.screenshot({
      path: test.info().outputPath('offline-unsaved-banner.png'),
    });

    const reopened = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/writer'),
    });
    room.reconnect('writer');
    await page.clock.runFor(5_000);
    await reopened;
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph offline edit'
    );
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => pendingWrites(page)).toBe(0);
  } finally {
    await second.close();
  }
});

test('the offline banner stays until the server sends the document again, not just until the socket reopens', async ({
  page,
  room,
}) => {
  await openEditor(page, room.url('writer'));
  room.disconnect('writer');
  await page.clock.runFor(DELAY_MS + 1_000);
  await expect(banner(page)).toHaveAttribute('data-sync-problem', 'offline');

  // The server takes the socket but doesn't send the document yet.
  room.withhold('writer');
  const reopened = page.waitForEvent('websocket', {
    predicate: (socket) => socket.url().endsWith('/writer'),
  });
  room.reconnect('writer');
  await page.clock.runFor(5_000);
  await reopened;
  await page.clock.runFor(1_000);
  await expect(banner(page)).toHaveAttribute('data-sync-problem', 'offline');

  room.release('writer');
  await expect(banner(page)).toHaveCount(0);
});
