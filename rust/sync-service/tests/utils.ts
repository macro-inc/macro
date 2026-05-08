import { EphemeralStore, LoroDoc } from 'loro-crdt';
import { Miniflare, type WebSocket } from 'miniflare';
import { assert } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  FromRemote,
  FromPeer,
} from '../bebop/generated/schema';
import fs from 'node:fs';
import { verify } from 'node:crypto';

export const INTERNAL_API_SECRET = 'local';

export const log = (...x) => [console.log(...x), x[0]][1]
export const sleep = (millis) => new Promise(resolve => setTimeout(resolve, millis));

async function migrateDatabase(mf: Miniflare) {
  const db = await mf.getD1Database("USER_PEER_MAPPING");
  const migration = fs.readFileSync("database/user-peer-mapping/migrations/0001_add_users.sql", "utf8");
  const statements = migration
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

export async function setupMiniflare() {
  const mf = new Miniflare({
    d1Databases: {
      USER_PEER_MAPPING: 'user-peer-mapping-database-id',
    },
    scriptPath: "./build/worker/shim.mjs",
    modules: true,
    modulesRules: [
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
    durableObjectsPersist: false,
    bindings: {
      DOCUMENT_PERMISSIONS_SECRET: "local",
      INTERNAL_API_SECRET_KEY: "INTERNAL_API_SECRET",
      INTERNAL_API_SECRET,
      SPS_API_SECRET_KEY: "local",
      SPS_URL:"http://localhost:8090",
      local:true,
    },
    compatibilityDate: '2025-03-05'
  });

  await migrateDatabase(mf);

  return mf;
}

type UserOptions = {
  userId: string;
  permissionLevel?: 'view' | 'edit' | 'owner' | 'comment';
};

function randInt(maxNum) {
    return Math.floor(Math.random() * maxNum)
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


  connection.getWebSocket().send(registrationMessage);

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
      connection.send(FromPeer.fromPeerUpdate({ update}).encode());
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
  const messages: ArrayBuffer[] = [];
  const waiters: ((message: ArrayBuffer) => void)[] = [];

  ws.addEventListener('message', (event) => {
    const message = event.data as ArrayBuffer;

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

      return new Promise<ArrayBuffer>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const index = waiters.indexOf(resolve);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Timed out waiting for WebSocket message after ${timeout}ms`
            )
          );
        }, timeout);

        const wrappedResolve = (message: ArrayBuffer) => {
          clearTimeout(timeoutId);
          resolve(message);
        };

        waiters.push(wrappedResolve);
      });
    },

    send(message: string | ArrayBuffer) {
      ws.send(message);
    },

    getWebSocket() {
      return ws;
    },
  };
}

export function getTokenForDocument(
  documentId: string,
  userId: string,
  permissionLevel: 'view' | 'edit' | 'owner'
): string {
  const token = jwt.sign({
    user_id: userId,
    document_id: documentId,
    access_level: permissionLevel,
    exp: Math.floor(Date.now() / 1000) + 60,
  }, "local")

  return token;
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
