import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  FromPeer,
  FromRemote,
  type IFromRemote,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import { test as base, expect, type Page } from '@playwright/test';
import { LoroDoc, LoroMap, VersionVector } from 'loro-crdt';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  intoFrames,
  Reassembler,
} from '../../../../../../../../../packages/collaboration/src/websocket/platform/framing';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/collaboration/browser-test/canvas-viewport.html';
const seedView = { x: 24, y: 48, scale: 125 };

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
  const server = new WebSocketServer({ server: http });
  http.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No room port');
  const peers = new Map<string, WebSocket>();
  const offline = new Set<string>();
  const writes: string[] = [];
  const id = randomUUID();
  const send = (peer: WebSocket, message: IFromRemote) => {
    for (const frame of intoFrames(FromRemote.encode(message)))
      peer.send(frame);
  };

  server.on('connection', (socket, request) => {
    const name = request.url?.slice(1);
    if (!name || offline.has(name)) {
      socket.close(1012, 'fixture offline');
      return;
    }
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
        writes.push(name);
        const before = doc.oplogVersion();
        doc.importBatch(message.value.updates);
        const update = doc.export({ mode: 'update', from: before });
        for (const [otherName, other] of peers) {
          if (otherName !== name || name === 'legacy') {
            send(other, FromRemote.fromRemoteUpdate({ update }));
          }
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
    send(
      socket,
      FromRemote.fromRemoteInitialSync({
        snapshot: doc.export({ mode: 'snapshot' }),
        awareness: new Uint8Array(),
      })
    );
  });

  return {
    writes,
    url(peer: string) {
      return `${fixture}?id=${id}&port=${address.port}&peer=${peer}`;
    },
    disconnect(peer: string) {
      offline.add(peer);
      peers.get(peer)?.close(1012, 'fixture offline');
    },
    reconnect(peer: string) {
      offline.delete(peer);
    },
    storedView() {
      const data = doc.getByPath('root/children/0/previewData');
      return data instanceof LoroMap ? data.toJSON() : data;
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

async function openEditor(page: Page, url: string, view = seedView) {
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
  await expect(page.getByRole('textbox')).toHaveAttribute(
    'contenteditable',
    'true'
  );
  await expect(page.getByLabel('Graphics canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.canvasCardControls?.location()))
    .toEqual({ x: view.x, y: view.y, s: view.scale });
}

async function settle(page: Page) {
  // The old camera bridge waited for the pointer to lift, then debounced for
  // 100ms. Advance the application timers past that boundary, then wait for
  // editor, WAL and transport acknowledgement to settle.
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.canvasViewportFixture?.flush())).toBe(
    true
  );
}

async function typeAtEnd(page: Page, text: string) {
  await page.evaluate(() => window.canvasViewportFixture?.placeAtEnd());
  await page.keyboard.insertText(text);
}

test('two current clients navigate locally while intentional markdown edits sync', async ({
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
    deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
  });
  try {
    const other = await second.newPage();
    await page.clock.install();
    await other.clock.install();
    await Promise.all([
      openEditor(page, room.url('left')),
      openEditor(other, room.url('right')),
    ]);
    await Promise.all([settle(page), settle(other)]);
    expect(room.writes).toEqual([]);
    expect(room.storedView()).toEqual({ view: seedView });

    await page.evaluate(() =>
      window.canvasCardControls?.navigate({ x: 101, y: 20, scale: 150 })
    );
    await other.evaluate(() =>
      window.canvasCardControls?.navigate({ x: 15, y: 101, scale: 75 })
    );
    await Promise.all([settle(page), settle(other)]);
    expect(room.writes).toEqual([]);
    expect(
      await page.evaluate(() => window.canvasCardControls?.location())
    ).toEqual({ x: 101, y: 20, s: 150 });
    expect(
      await other.evaluate(() => window.canvasCardControls?.location())
    ).toEqual({ x: 15, y: 101, s: 75 });

    await typeAtEnd(page, ' from the left');
    await settle(page);
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph from the left'
    );
    await settle(other);
    expect(room.writes).toEqual(['left']);
    expect(room.storedView()).toEqual({ view: seedView });
  } finally {
    await second.close();
  }
});

test('legacy viewport payload reaches current clients and offline authored text replays without echoing it', async ({
  page,
  browser,
  room,
}) => {
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await page.clock.install();
    await other.clock.install();
    await Promise.all([
      openEditor(page, room.url('current')),
      openEditor(other, room.url('legacy')),
    ]);
    await Promise.all([settle(page), settle(other)]);
    expect(room.writes).toEqual([]);

    await page.evaluate(() =>
      window.canvasCardControls?.navigate({ x: 101, y: 20, scale: 150 })
    );
    await settle(page);
    room.disconnect('current');
    await typeAtEnd(page, ' offline');
    await page.clock.runFor(500);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasViewportFixture?.pendingWrites())
      )
      .toBeGreaterThan(0);
    await expect(other.getByRole('textbox')).toContainText('Shared paragraph');
    expect(await other.getByRole('textbox').textContent()).not.toContain(
      'offline'
    );

    const legacyView = { x: -54, y: 91, scale: 60 };
    expect(
      await other.evaluate(
        (view) => window.canvasViewportFixture?.writeLegacyView(view),
        legacyView
      )
    ).toBe(true);
    expect(room.writes).toEqual(['legacy']);
    expect(room.storedView()).toEqual({ view: legacyView });

    const reopened = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/current'),
    });
    room.reconnect('current');
    await page.clock.runFor(3_000);
    await reopened;
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph offline'
    );
    await settle(page);
    expect(
      await page.evaluate(() => window.canvasViewportFixture?.pendingWrites())
    ).toBe(0);
    expect(
      await page.evaluate(() => window.canvasCardControls?.location())
    ).toEqual({ x: 101, y: 20, s: 150 });
    expect(room.writes).toEqual(['legacy', 'current']);
    expect(room.storedView()).toEqual({ view: legacyView });

    await typeAtEnd(other, ' from the old peer');
    await settle(other);
    await expect(page.getByRole('textbox')).toContainText(
      'Shared paragraph offline from the old peer'
    );
    await typeAtEnd(page, ' from the current peer');
    await settle(page);
    await expect(other.getByRole('textbox')).toContainText(
      'Shared paragraph offline from the old peer from the current peer'
    );
    expect(room.writes).toEqual(['legacy', 'current', 'legacy', 'current']);
    expect(room.storedView()).toEqual({ view: legacyView });
    const fresh = await second.newPage();
    await fresh.clock.install();
    await openEditor(fresh, room.url('fresh'), legacyView);
    await settle(fresh);
    expect(room.writes).toEqual(['legacy', 'current', 'legacy', 'current']);
  } finally {
    await second.close();
  }
});
