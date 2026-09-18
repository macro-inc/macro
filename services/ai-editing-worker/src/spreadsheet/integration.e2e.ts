import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SpreadsheetReadResponse,
  SpreadsheetRequest,
  SpreadsheetResponse,
} from '@macro-inc/spreadsheet/ai-types';
import { LoroDoc } from 'loro-crdt';
import { Miniflare, type WebSocket } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FromPeer,
  FromRemote,
  InitializeFromSnapshotRequest,
} from '../../../sync-service/bebop/generated/schema';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const syncPath = join(repo, 'services/sync-service');
const bundle =
  process.env.SPREADSHEET_AI_WORKER_BUNDLE ??
  join(tmpdir(), 'spreadsheet-ai-worker-build');
let mf: Miniflare;
// Miniflare's conditional Fetcher replacement conflicts with Bun's global
// Request types. Keep the exercised service-binding surface explicit here.
let sync: { fetch(input: string, init: RequestInit): Promise<Response> };

function token(
  id: string,
  permission: 'view' | 'comment' | 'edit' | 'owner' = 'edit',
  userId = 'macro|spreadsheet-test@example.com'
) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      document_id: id,
      user_id: userId,
      actor: 'spreadsheet-test-agent',
      access_level: permission,
      exp: Math.floor(Date.now() / 1000) + 300,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', 'local')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        name: 'spreadsheet-ai',
        scriptPath: join(bundle, 'index.js'),
        modules: true,
        modulesRoot: bundle,
        modulesRules: [
          { type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true },
          { type: 'Text', include: ['**/*.md'], fallthrough: true },
        ],
        compatibilityDate: '2025-07-22',
        compatibilityFlags: ['nodejs_compat', 'enable_request_signal'],
        bindings: { SYNC_WS_BASE: 'https://sync.test' },
        outboundService: 'spreadsheet-sync',
      },
      {
        name: 'spreadsheet-sync',
        scriptPath: join(syncPath, 'build/worker/shim.mjs'),
        modules: true,
        modulesRoot: syncPath,
        modulesRules: [
          { type: 'ESModule', include: ['**/build/index.js'] },
          { type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true },
        ],
        compatibilityDate: '2025-03-05',
        durableObjects: {
          DOCUMENT_SYNC_SESSION: {
            className: 'DocumentSyncSession',
            useSQLite: true,
          },
        },
        d1Databases: { USER_PEER_MAPPING: 'spreadsheet-test-peer-mapping' },
        r2Buckets: { DOCUMENT_SNAPSHOT_BUCKET: 'spreadsheet-test-snapshots' },
        kvNamespaces: {
          DOCUMENT_VERSIONING_KV: 'spreadsheet-test-versions',
          SNAPSHOT_STORE_KV: 'spreadsheet-test-cache',
        },
        bindings: {
          DOCUMENT_PERMISSIONS_SECRET: 'local',
          INTERNAL_API_SECRET_KEY: 'INTERNAL_API_SECRET',
          INTERNAL_API_SECRET: 'local',
          SPS_API_SECRET_KEY: 'local',
          SPS_URL: 'http://discard.test',
          local: true,
        },
        // All telemetry/indexing outbound calls remain inside this fixture.
        outboundService: async () => new Response(null, { status: 204 }),
      },
    ],
  });
  sync = (await mf.getWorker('spreadsheet-sync')) as unknown as typeof sync;
  const db = await mf.getD1Database('USER_PEER_MAPPING', 'spreadsheet-sync');
  for (const name of ['0001_add_users.sql', '0002_add_blame.sql']) {
    const sql = readFileSync(
      join(syncPath, 'database/user-peer-mapping/migrations', name),
      'utf8'
    );
    for (const statement of sql
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
});
afterAll(async () => {
  await mf?.dispose();
});

// Queue binary messages before accepting, including the initial snapshot.
function createTestWebSocket(ws: WebSocket) {
  const messages: ArrayBuffer[] = [];
  let waiting: ((data: ArrayBuffer) => void) | undefined;
  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string')
      throw new Error('Expected binary sync message');
    const data =
      event.data instanceof Uint8Array
        ? new Uint8Array(event.data).buffer
        : event.data;
    if (waiting) waiting(data);
    else messages.push(data);
  });
  return {
    getWebSocket: () => ws,
    send: (data: Uint8Array) => ws.send(new Uint8Array(data)),
    waitForNextMessage(): Promise<ArrayBuffer> {
      const queued = messages.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = undefined;
          reject(new Error('Timed out waiting for sync message'));
        }, 5000);
        waiting = (data) => {
          waiting = undefined;
          clearTimeout(timer);
          resolve(data);
        };
      });
    },
  };
}

async function create() {
  const id = crypto.randomUUID();
  const response = await sync.fetch(
    `https://sync.test/document/${id}/initialize`,
    {
      method: 'POST',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token(id)}` },
      body: new Uint8Array(
        InitializeFromSnapshotRequest.encode({
          snapshot: new Uint8Array(
            readFileSync(join(repo, 'static_assets/spreadsheet-golden.1.bin'))
          ),
        })
      ).buffer,
    }
  );
  expect(response.status).toBe(200);
  return id;
}

async function request(
  id: string,
  request: SpreadsheetRequest,
  documentToken = token(id)
) {
  return mf.dispatchFetch('http://localhost/spreadsheet', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: id, documentToken, request }),
  });
}
async function success(
  id: string,
  input: SpreadsheetRequest
): Promise<SpreadsheetResponse> {
  const response = await request(id, input);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as SpreadsheetResponse;
}

describe('real spreadsheet editing worker and sync Durable Object', () => {
  it('edits with no browser, broadcasts to an open collaborator, and refuses to overwrite their newer edit', async () => {
    const id = await create();
    const initial = await success(id, { action: 'read' });
    await success(id, {
      action: 'edit',
      expectedRevision: initial.revision,
      operations: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'A1', value: '10' }],
        },
      ],
    });
    const response = (await sync.fetch(
      `https://sync.test/document/${id}/connect?token=${token(id, 'edit', 'macro|collaborator@example.com')}`,
      {
        headers: { Upgrade: 'websocket' },
      }
    )) as Response & { webSocket: WebSocket };
    expect(response.webSocket).toBeTruthy();
    const socket = createTestWebSocket(response.webSocket);
    response.webSocket.accept();
    const doc = new LoroDoc();
    try {
      const first = FromRemote.decode(
        new Uint8Array(await socket.waitForNextMessage())
      );
      if (!first.isRemoteInitialSync())
        throw new Error('Expected initial sync');
      doc.import(first.value.snapshot);
      expect(doc.getMap('spreadsheetValues').get('A1')).toBe('10');
      socket.send(FromPeer.fromPeerRegisterId({ peerid: doc.peerId }).encode());
      const from = doc.version();
      // An unsent collaborator edit must survive importing an AI delta.
      doc.getMap('spreadsheetValues').set('C1', 'local draft');
      doc.commit();
      const current = await success(id, { action: 'read' });
      await success(id, {
        action: 'edit',
        expectedRevision: current.revision,
        operations: [
          {
            type: 'set_cells',
            sheetId: 'sheet1',
            cells: [{ address: 'B1', value: '=A1*2' }],
          },
        ],
      });
      for (;;) {
        const message = FromRemote.decode(
          new Uint8Array(await socket.waitForNextMessage())
        );
        if (message.isRemoteUpdate()) {
          doc.import(message.value.update);
          break;
        }
      }
      expect(doc.getMap('spreadsheetValues').get('B1')).toBe('=A1*2');
      expect(doc.getMap('spreadsheetValues').get('C1')).toBe('local draft');
      const stale = await success(id, { action: 'read' });
      doc.getMap('spreadsheetValues').set('A1', '30');
      doc.commit();
      const operationId = crypto.randomUUID();
      socket.send(
        FromPeer.fromPeerUpdate({
          id: operationId,
          updates: [doc.export({ mode: 'update', from })],
        }).encode()
      );
      for (;;) {
        const message = FromRemote.decode(
          new Uint8Array(await socket.waitForNextMessage())
        );
        if (message.isRemoteUpdateAck() && message.value.id === operationId)
          break;
      }
      const denied = await request(id, {
        action: 'edit',
        expectedRevision: stale.revision,
        operations: [
          {
            type: 'set_cells',
            sheetId: 'sheet1',
            cells: [{ address: 'A1', value: 'clobber' }],
          },
        ],
      });
      expect(denied.status).toBe(409);
      const final = (await success(id, {
        action: 'read',
        ranges: ['A1:C1'],
      })) as SpreadsheetReadResponse;
      expect(
        final.ranges[0].cells.find((cell) => cell.address === 'A1')?.source
      ).toBe('30');
      expect(
        final.ranges[0].cells.find((cell) => cell.address === 'B1')?.display
      ).toBe('60');
      expect(
        final.ranges[0].cells.find((cell) => cell.address === 'C1')?.source
      ).toBe('local draft');
    } finally {
      socket.getWebSocket().close();
      doc.free();
    }
  });

  it('reads, edits a multi-sheet workbook, calculates what-if values without writes, and reopens persisted values', async () => {
    const id = await create();
    const initial = await success(id, { action: 'read' });
    const edited = await success(id, {
      action: 'edit',
      expectedRevision: initial.revision,
      operations: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [
            { address: 'A1', value: '10' },
            { address: 'A2', value: '20' },
            { address: 'B1', value: '=A1*2' },
          ],
        },
        { type: 'add_sheet', name: 'Summary' },
        {
          type: 'set_cells',
          sheetId: 'Summary',
          cells: [{ address: 'A1', value: '=SUM(Sheet1!A1:A2)' }],
        },
        {
          type: 'format_cells',
          sheetId: 'Summary',
          range: 'A1',
          style: { bold: true, format: 'currency' },
        },
      ],
    });
    expect(edited).toMatchObject({
      action: 'edit',
      applied: true,
      sheets: [{ name: 'Sheet1' }, { name: 'Summary' }],
    });
    const calculated = await success(id, {
      action: 'calculate',
      sheetId: 'sheet1',
      overrides: [
        { sheetId: 'sheet1', cells: [{ address: 'A1', value: '50' }] },
      ],
      formulas: [{ formula: '=Summary!A1' }, { formula: '=B1' }],
    });
    expect(calculated).toMatchObject({
      revision: edited.revision,
      results: [{ value: 70 }, { value: 100 }],
    });
    const reopened = await success(id, {
      action: 'read',
      sheetId: 'Summary',
      ranges: ['A1'],
      includeStyles: true,
    });
    expect(reopened).toMatchObject({
      revision: edited.revision,
      ranges: [
        {
          cells: [
            {
              source: '=SUM(Sheet1!A1:A2)',
              value: 30,
              display: '$30.00',
              style: { bold: true, format: 'currency' },
            },
          ],
        },
      ],
    });
  });

  it('rejects stale and failed batches without losing current cells or partially adding sheets', async () => {
    const id = await create();
    const original = await success(id, { action: 'read' });
    const updated = await success(id, {
      action: 'edit',
      expectedRevision: original.revision,
      operations: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'A1', value: 'current' }],
        },
      ],
    });
    const stale = await request(id, {
      action: 'edit',
      expectedRevision: original.revision,
      operations: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'A1', value: 'stale' }],
        },
      ],
    });
    expect(stale.status).toBe(409);
    const invalid = await request(id, {
      action: 'edit',
      expectedRevision: updated.revision,
      operations: [
        { type: 'add_sheet', name: 'Should not exist' },
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'AA1', value: 'invalid' }],
        },
      ],
    });
    expect(invalid.status).toBe(400);
    const after = (await success(id, {
      action: 'read',
    })) as SpreadsheetReadResponse;
    expect(after.revision).toBe(updated.revision);
    expect(after.sheets).toHaveLength(1);
    expect(after.ranges[0].cells[0].source).toBe('current');
  });

  it('permits view-only inspection and calculations but rejects viewer/comment edits and wrong-document tokens', async () => {
    const id = await create();
    const current = await success(id, { action: 'read' });
    expect(
      (await request(id, { action: 'read' }, token(id, 'view'))).status
    ).toBe(200);
    expect(
      (
        await request(
          id,
          { action: 'calculate', formulas: [{ formula: '=1+2' }] },
          token(id, 'view')
        )
      ).status
    ).toBe(200);
    for (const level of ['view', 'comment'] as const) {
      const denied = await request(
        id,
        {
          action: 'edit',
          expectedRevision: current.revision,
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [{ address: 'A1', value: 'forbidden' }],
            },
          ],
        },
        token(id, level)
      );
      expect(denied.status).toBe(403);
    }
    expect(
      (await request(id, { action: 'read' }, token(crypto.randomUUID()))).status
    ).toBe(401);
    expect(
      (await request(id, { action: 'read' }, 'invalid-token')).status
    ).toBe(401);
    expect((await success(id, { action: 'read' })).revision).toBe(
      current.revision
    );
  });

  it('allows only one simultaneous batch for a shared revision', async () => {
    const id = await create();
    const current = await success(id, { action: 'read' });
    const replies = await Promise.all(
      ['A1', 'B1'].map((address) =>
        request(id, {
          action: 'edit',
          expectedRevision: current.revision,
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [{ address, value: address }],
            },
          ],
        })
      )
    );
    expect(replies.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const result = (await success(id, {
      action: 'read',
    })) as SpreadsheetReadResponse;
    expect(result.ranges[0].cells).toHaveLength(1);
  });

  it('validates unknown commands, style injection and excessive request bodies before mutation', async () => {
    const id = await create();
    const initial = await success(id, { action: 'read' });
    const invalid = await mf.dispatchFetch('http://localhost/spreadsheet', {
      method: 'POST',
      body: JSON.stringify({
        documentId: id,
        documentToken: token(id),
        request: {
          action: 'edit',
          expectedRevision: initial.revision,
          operations: [
            {
              type: 'format_cells',
              sheetId: 'sheet1',
              range: 'A1',
              style: { value: 'injected' },
            },
          ],
        },
      }),
    });
    expect(invalid.status).toBe(400);
    const oversized = await mf.dispatchFetch('http://localhost/spreadsheet', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);
    expect((await success(id, { action: 'read' })).revision).toBe(
      initial.revision
    );
  });
});
