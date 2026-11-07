import { runtimeCapture, sendRecordedInput } from "./transcript";
import { intoFrames, Reassembler } from '../../../packages/collaboration/src/websocket/platform/framing/frames';
import { EphemeralStore, LoroDoc } from 'loro-crdt';
import { Miniflare, type MiniflareOptions, type WebSocket } from 'miniflare';
import { assert, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  FromRemote,
  FromPeer,
} from '../../../crates/sync_protocol/bebop/generated/schema';
import fs from 'node:fs';
import { verify } from 'node:crypto';

const rawDispatches = new WeakMap<Miniflare, Miniflare['dispatchFetch']>();

export function dispatchConcurrent(mf: Miniflare, ...args: Parameters<Miniflare['dispatchFetch']>) {
  return rawDispatches.get(mf)!(...args);
}

const evictionOwners = new WeakMap<object, Miniflare>();

export const INTERNAL_API_SECRET = 'local';

export const log = (...x) => [console.log(...x), x[0]][1]
export const sleep = (millis) => new Promise(resolve => setTimeout(resolve, millis));

async function migrateDatabase(mf: Miniflare) {
  const db = await mf.getD1Database("USER_PEER_MAPPING");
  const migrationsDir = "database/user-peer-mapping/migrations";
  for (const file of fs.readdirSync(migrationsDir).sort()) {
    const migration = fs.readFileSync(`${migrationsDir}/${file}`, "utf8");
    const statements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
}

export async function setupMiniflare(
  options: {
    persistPath?: string;
    migrate?: boolean;
    dssUrl?: string;
    lexicalServiceUrl?: string;
    lexicalServiceAuthKey?: string | null;
    fetchMock?: MiniflareOptions['fetchMock'];
  } = {},
) {
  const persist = (name: string) => options.persistPath ? `${options.persistPath}/${name}` : false;
  const capture = process.env.SYNC_RECORD === "1" ? runtimeCapture(Boolean(expect.getState().currentTestName) && !options.persistPath, options.persistPath) : undefined;
  const mf = new Miniflare({
    ...(capture ? { handleRuntimeStdio: capture.stdio } : {}),
    d1Databases: {
      USER_PEER_MAPPING: 'user-peer-mapping-database-id',
    },
    scriptPath: "./tests/worker.mjs",
    modules: true,
    modulesRules: [
      { type: "ESModule", include: ["**/build/index.js", "**/*.mjs", "**/src/transcript/*.js"] },
      { type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true },
    ],
    durableObjects: {
      DOCUMENT_SYNC_SESSION: { className: "DocumentSyncSession", useSQLite: true},
    },
    r2Buckets: {
      DOCUMENT_SNAPSHOT_BUCKET: "document-snapshot-bucket",
    },
    kvNamespaces: {
      DOCUMENT_VERSIONING_KV: "document-versioning-kv",
      SNAPSHOT_STORE_KV: "snapshot-store-kv-test",
    },
    cachePersist: false,
    workflowsPersist: false,
    durableObjectsPersist: persist('objects'),
    d1Persist: persist('d1'),
    kvPersist: persist('kv'),
    r2Persist: persist('r2'),
    fetchMock: options.fetchMock,
    bindings: {
      SYNC_RECORD: process.env.SYNC_RECORD === "1",
      ...(options.fetchMock ? { DSS_URL: "https://dss.test", DSS_INTERNAL_AUTH_KEY: "local" } : {}),
      DOCUMENT_PERMISSIONS_SECRET: "local",
      INTERNAL_API_SECRET_KEY: "INTERNAL_API_SECRET",
      INTERNAL_API_SECRET,
      SPS_API_SECRET_KEY: "local",
      SPS_URL: "http://localhost:8092",
      local:true,
      ...(options.dssUrl ? { DSS_URL: options.dssUrl, DSS_INTERNAL_AUTH_KEY: "local" } : {}),
      ...(options.lexicalServiceUrl
        ? { LEXICAL_SERVICE_URL: options.lexicalServiceUrl, ...(options.lexicalServiceAuthKey === null ? {} : { LEXICAL_SERVICE_AUTH_KEY: options.lexicalServiceAuthKey ?? "lexical-key" }) }
        : {}),
    },
    compatibilityFlags: ['unsafe_module'],
    compatibilityDate: '2025-03-05'
  });

  const getNamespace = mf.getDurableObjectNamespace.bind(mf);
  mf.getDurableObjectNamespace = async (...args: Parameters<typeof getNamespace>) => {
    const namespace = await getNamespace(...args);
    return new Proxy(namespace, {
      get(target, key) {
        if (key === 'get') return (...args: Parameters<typeof target.get>) => {
          const stub = target.get(...args);
          evictionOwners.set(stub, mf);
          return stub;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  rawDispatches.set(mf, mf.dispatchFetch.bind(mf));
  capture?.attach(mf);

  if (options.migrate !== false) await migrateDatabase(mf);

  return mf;
}

type UserOptions = {
  userId: string;
  permissionLevel?: 'view' | 'edit' | 'owner' | 'comment';
};

function randInt(maxNum) {
    const random = process.env.SYNC_RECORD === '1'
      ? Number.parseInt(crypto.randomUUID().slice(0, 8), 16) / 0x100000000
      : Math.random();
    return Math.floor(random * maxNum)
}
function randName(length = 6) {
    let out = '';
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
        out += alpha[randInt(alpha.length)]
    }
    return out
}
export function *range(max: number) {
  for (let i = 0; i < max; i++) {
    yield i;
  }
}

export async function createDocument(mf: Miniflare, name = randName()) {
  return {
    name,
    async createUser(options?: UserOptions) {
      return await createTestUser(mf, name, options);
    },
    async createMultipleUsers(n_users: number, options?: UserOptions) {
      let out = [];
      for (let i of range(n_users)) {
        let u = await this.createUser(options);
        out.push(u);
      }
      return out;
    },
    async copy(targetId = randName(), versionId?: any) {
      let response = await copyDocument(mf, name, targetId, versionId);
      assert(response.status == 200);
      return createDocument(mf, targetId);
    }
  }
}

export const copyDocument = (mf, sourceId: string, targetId: string, versionId?: any) => {
  const body: any = { target_document_id: targetId };
  if (versionId) {
    body.version_id = versionId;
  }

  return mf.dispatchFetch(`http://localhost:8787/document/${sourceId}/copy`, {
    method: "POST",
    headers: {
      "x-internal-auth-key": INTERNAL_API_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
};

export async function createTestUser(mf: Miniflare, documentId = 'test-doc', options?: UserOptions) {
  let loroDoc = new LoroDoc();
  let connection = await connectToDocumentForTesting(mf, documentId, options);
  let awareness = new EphemeralStore(60000);

  const message = await connection.waitForNextMessage();

  const initialSync = FromRemote.decode(new Uint8Array(message));

  assert(initialSync.isRemoteInitialSync());

  loroDoc.import(initialSync.value.snapshot);

  if (initialSync.value.awareness) {
    awareness.apply(initialSync.value.awareness);
  }

  const registrationMessage = FromPeer.fromPeerRegisterId({ peerid: loroDoc.peerId }).encode();


  connection.send(registrationMessage);
  if (process.env.SYNC_RECORD === '1') {
    connection.send('ping');
    assert(await connection.waitForNextMessage() === 'pong');
  }

  return {
    doc: loroDoc,
    awareness,
    connection,
    import(update: Uint8Array) {
      let status = loroDoc.import(update);
      assert(Object.entries(status.pending ?? {})?.length === 0);
    },
    batchImport(updates: Uint8Array[]) {
      loroDoc.importBatch(updates);
    },
    async readNextMessage() {
      let message = await connection.waitForNextMessage();
      return FromRemote.decode(new Uint8Array(message));
    },
    async readSyncMessage() {
      let sync = await this.readNextMessage();
      if (sync.isRemoteUpdateAck()) {
        return this.readSyncMessage();
      }
      assert(sync.isRemoteUpdate());
      return sync.value.update;
    },
    makeChange(text: string) {
      loroDoc.getText('content').push(text);
      loroDoc.commit();
      const update = loroDoc.export({ mode: 'update' });
      connection.send(FromPeer.fromPeerUpdate({ updates: [update], id: crypto.randomUUID() }).encode());
    },
    getState() {
      return loroDoc.getText('content').toString();
    },
    async importNextUpdate() {
      let update = await this.readSyncMessage();
      this.import(update);
    },
    async copyDocument(targetId = randName(), versionId?: any) {
      const response = await copyDocument(mf, documentId, targetId, versionId);
      assert(response.status == 200);
      return createDocument(mf, targetId);

    },
    ...connection,
  };
}

export function createTestWebSocket(ws: WebSocket) {
  const reassembler = new Reassembler();
  const messages: (ArrayBuffer | string)[] = [];
  const waiters: ((message: ArrayBuffer | string) => void)[] = [];

  ws.addEventListener('message', (event) => {
    const message = typeof event.data === 'string'
      ? event.data
      : reassembler.push(new Uint8Array(event.data as ArrayBuffer))?.buffer;
    if (message === undefined) return;

    if (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve(message);
    } else {
      messages.push(message);
    }
  });

  return {
    async waitForNextMessage(timeout = 5000): Promise<ArrayBuffer | string> {
      if (messages.length > 0) {
        return messages.shift()!;
      }

      return new Promise<ArrayBuffer | string>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const index = waiters.indexOf(wrappedResolve);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Timed out waiting for WebSocket message after ${timeout}ms`
            )
          );
        }, timeout);

        const wrappedResolve = (message: ArrayBuffer | string) => {
          clearTimeout(timeoutId);
          resolve(message);
        };

        waiters.push(wrappedResolve);
      });
    },

    send(message: string | ArrayBuffer | Uint8Array): void {
      // The generated codec reuses its backing buffer; queued inputs own bytes.
      const payload = typeof message === 'string' ? message : new Uint8Array(message).slice();
      sendRecordedInput(ws, () => {
        if (typeof payload === 'string') ws.send(payload);
        else for (const frame of intoFrames(payload)) ws.send(frame);
      }, payload === 'ping');
    },

    getWebSocket() {
      return ws;
    },
  };
}

export function getTokenForDocument(
  documentId: string,
  userId: string,
  permissionLevel: 'view' | 'edit' | 'owner' | 'comment'
): string {
  const token = jwt.sign({
    user_id: userId,
    document_id: documentId,
    access_level: permissionLevel,
    exp: Math.floor(Date.now() / 1000) + 60,
  }, "local")

  return token;
}


export function getTokenForSurface(
  surfaceId: string,
  permissionLevel: 'view' | 'comment' | 'edit' | 'owner' = 'edit',
  expiresAt = Math.floor(Date.now() / 1000) + 60,
): string {
  return jwt.sign({
    session_kind: 'surface',
    surface_id: surfaceId,
    user_id: 'surface-user',
    access_level: permissionLevel,
    exp: expiresAt,
    iss: 'document_storage_service',
  }, 'local', { noTimestamp: true });
}

export async function connectToDocumentForTesting(
  mf: Miniflare,
  documentId: string,
  options?: UserOptions
) {
  const token = getTokenForDocument(documentId, options?.userId ?? "test-user", options?.permissionLevel ?? "owner");

  const response = await mf.dispatchFetch(
    `http://localhost:8787/document/${documentId}/connect?token=${token}`,
    {
      headers: {
        Upgrade: 'websocket',
      },
    }
  );

  const ws = response.webSocket;
  if (!ws) {
    throw new Error('Failed to establish WebSocket connection');
  }
  let wsWrapper = createTestWebSocket(ws);

  ws.accept();

  return wsWrapper;
}

/** Evict this local DO while keeping its native hibernatable sockets and storage. */
export async function abortObjectBetweenMessages(stub: { id: { toString(): string } }) {
  const owner = evictionOwners.get(stub);
  if (!owner) throw new Error('Use a stub from setupMiniflare()');
  const response = await owner.dispatchFetch(`http://sync-test/__sync_test_evict?room=${stub.id.toString()}`);
  assert(response.status === 204);
}
