import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { LoroDoc } from 'loro-crdt';
import { beforeAll, expect, test } from 'vitest';
import {
  DocSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { BrowserWALStore, LORO_WAL_DB_NAME } from '../collab/wal';
import {
  ABI_MAJOR,
  Access,
  ContainerPathMsg,
  Failure,
  SessionConfigMsg,
  SessionInputMsg,
  StorageOpMsg,
  Transport,
  ViewEffectMsg,
} from './abi.generated';
import { emptyInput } from './input';
import { decodeOutput } from './output';
import { StorageAdapter } from './storage';

beforeAll(() => {
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  });
});

test('shipping legacy WAL is adopted and replayed by a signed-in native session', async () => {
  const doc = 'native-legacy-recovery';
  const owner = '00000000-0000-0000-0000-000000000091';
  const user = 'fixture-user';
  const source = new LoroDoc();
  source.setPeerId('51');
  source.setRecordTimestamp(false);
  source.getMap('root').set('private', 'retained legacy edit');
  const wal = new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, doc);
  await wal.append(source.export({ mode: 'update' }));
  const before = await wal.getAll();
  expect(before).toHaveLength(1);
  const storage = new StorageAdapter(doc, owner, user);
  const wall = Date.now();
  const session = DocSession.create(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc,
      session: owner,
      user,
      peers: [71n, 72n, 73n],
      access: Access.Edit,
      transport: Transport.None,
      durable: true,
      chatter: false,
      headless: false,
      viewEngine: 1,
      viewOs: 0,
      token: '',
      traceparent: '',
      coalesce: 25,
      snapshotInterval: 0,
      observed: [],
    }),
    0,
    wall
  );
  try {
    session.input(SessionInputMsg.encode(emptyInput(0)), 0, wall);
    const queue = decodeOutput(session.takeOutput()).effects;
    let adopted = 0;
    for (let handled = 0; queue.length && handled < 32; handled++) {
      const effect = queue.shift();
      if (!effect || effect.tag !== 6) continue;
      const op = StorageOpMsg.decode(effect.payload);
      const result = await storage.execute(op);
      expect(result.failure).toBe(Failure.None);
      if (result.kind === 'loaded') {
        session.storageLoaded(
          effect.a,
          result.payload,
          result.failure,
          0,
          wall
        );
      } else if (result.kind === 'adopted') {
        adopted += result.adopted;
        session.storageAdopted(
          effect.a,
          result.adopted,
          result.failure,
          0,
          wall
        );
      } else {
        session.storageDone(effect.a, result.ok, result.failure, 0, wall);
      }
      const output = session.takeOutput();
      if (output.length) queue.push(...decodeOutput(output).effects);
    }
    expect(queue).toHaveLength(0);
    expect(adopted).toBe(1);
    session.input(SessionInputMsg.encode(emptyInput(1)), 1, wall + 1);
    const read = ViewEffectMsg.decode(
      session.read(ContainerPathMsg.encode({ root: 'root', steps: [] }))
    );
    expect(read.values.some((v) => v.str === 'retained legacy edit')).toBe(
      true
    );
    const after = await wal.getAll();
    expect(after).toHaveLength(1);
    expect(after[0]?.update).toEqual(before[0]?.update);
  } finally {
    session.free();
  }
});
