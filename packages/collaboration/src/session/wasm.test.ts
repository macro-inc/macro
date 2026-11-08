import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import {
  DocSession,
  EditorSession,
  initSync,
  SyncRouter,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { ToRouter } from '../sync-service/generated/schema';
import {
  ABI_MAJOR,
  Access,
  ContainerPathMsg,
  EditorInputMsg,
  LocalStateMsg,
  QueryMsg,
  QueryReplyMsg,
  SessionConfigMsg,
  SessionInputMsg,
  StorageOpMsg,
  TelemetryMsg,
  Transport,
  TypeTableMsg,
  ViewEffectMsg,
} from './abi.generated';
import { emptyInput } from './input';
import { decodeOutput } from './output';

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
const config = () =>
  SessionConfigMsg.encode({
    doc: 'wasm-fixture',
    session: '00000000-0000-0000-0000-000000000001',
    user: 'fixture-user',
    peers: [7n, 8n, 9n],
    access: Access.Edit,
    transport: Transport.None,
    durable: false,
    chatter: false,
    headless: false,
    viewEngine: 1,
    viewOs: 0,
    token: '',
    traceparent: '',
    coalesce: 25,
    snapshotInterval: 0,
    observed: [],
  });
const state = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'a',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
};
test('literal primitive typing uses one call, no I/O, and preserves UTF-16 and ABI ownership', () => {
  expect(() => EditorSession.create(999, new Uint8Array(), 0, 0)).toThrow(
    'AbiMismatch'
  );
  const session = EditorSession.create(ABI_MAJOR, config(), 0, 0);
  session.input(SessionInputMsg.encode(emptyInput(0)), 0, 0);
  session.takeOutput();
  session.input(SessionInputMsg.encode(emptyInput(1)), 1, 1);
  session.takeOutput();
  session.input(
    SessionInputMsg.encode({
      ...emptyInput(2),
      editor: EditorInputMsg.fromEditorSetState({
        json: JSON.stringify(state),
      }),
    }),
    2,
    2
  );
  const first = session.takeOutput();
  const copy = first.slice();
  const query = QueryReplyMsg.decode(
    session.query(QueryMsg.encode({ kind: 4, key: 0, text: 'text', flags: 0 }))
  );
  const key = query.keys[0];
  const flags = session.textFromView(key, 'a😀', 3, 3, 0, 0, undefined, 3);
  expect(flags & 2).toBe(0);
  expect(session.textContent()).toBe('a😀');
  expect(session.wakeAt()).toBe(26);
  const rejected = session.textFromView(key, 'a\ud800', 2, 2, 0, 0, undefined, 4);
  expect(rejected & 16).toBe(16);
  expect(decodeOutput(session.takeOutput()).viewEffects.some(effect => effect.kind === 2 && effect.text.includes('LoneSurrogate'))).toBe(true);
  expect(session.textContent()).toBe('a😀');
  const huge = {
    root: {
      ...state.root,
      children: Array.from({ length: 5000 }, () => state.root.children[0]),
    },
  };
  session.input(
    SessionInputMsg.encode({
      ...emptyInput(2),
      editor: EditorInputMsg.fromEditorSetState({ json: JSON.stringify(huge) }),
    }),
    5,
    5
  );
  expect(first).toEqual(copy);
  expect(decodeOutput(first).view.length).toBeGreaterThan(0);
  expect(
    TypeTableMsg.decode(session.typeTable()).rows.some(
      (r) => r.name === 'table'
    )
  ).toBe(true);
  session.free();
});
test('generic preorder ABI preserves nested bytes and integers beyond Number precision', () => {
  const session = DocSession.create(ABI_MAJOR, config(), 0, 0);
  session.input(SessionInputMsg.encode(emptyInput(0)), 0, 0);
  session.input(SessionInputMsg.encode(emptyInput(1)), 1, 1);
  const value = [
    {
      kind: 7,
      key: '',
      num: 0,
      int: 0n,
      str: '',
      bytes: new Uint8Array(),
      children: 2,
    },
    {
      kind: 3,
      key: 'large',
      num: 0,
      int: 9007199254740993n,
      str: '',
      bytes: new Uint8Array(),
      children: 0,
    },
    {
      kind: 5,
      key: 'binary',
      num: 0,
      int: 0n,
      str: '',
      bytes: new Uint8Array([0, 255]),
      children: 0,
    },
  ];
  const flags = session.input(
    SessionInputMsg.encode({
      ...emptyInput(3),
      operations: [
        {
          kind: 0,
          path: { root: 'fixture', steps: [] },
          key: 'entry',
          index: 0,
          len: 0,
          value,
        },
      ],
    }),
    2,
    2
  );
  if (flags & 16) throw new Error('Generic mutation failed');
  const read = ViewEffectMsg.decode(
    session.read(ContainerPathMsg.encode({ root: 'fixture', steps: [] }))
  );
  expect(read.values.some((v) => v.int === 9007199254740993n)).toBe(true);
  expect(
    read.values.some((v) => v.bytes.length === 2 && v.bytes[1] === 255)
  ).toBe(true);
  session.free();
});
test('Bebop byte arrays decode as subarray views and storage metadata keeps bigint sequences', () => {
  const wire = StorageOpMsg.encode({
    kind: 2,
    doc: 'fixture',
    owner: 'owner',
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: true,
    terminal: true,
    record: {
      seq: 9007199254740993n,
      createdAt: 0n,
      user: 'fixture-user',
      foreign: true,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array([0, 255]),
    },
    snapshot: new Uint8Array(),
    coversOwner: '',
    coversSeq: 0n,
  });
  const decoded = StorageOpMsg.decode(wire);
  expect(decoded.record.bytes.buffer).toBe(wire.buffer);
  expect(decoded.record.seq).toBe(9007199254740993n);
  expect(StorageOpMsg.encode(decoded)).toEqual(wire);
  const loaded = LocalStateMsg.encode({
    snapshot: new Uint8Array([1, 255]),
    coversOwner: '',
    coversSeq: 0n,
    orphans: [],
    assist: [],
  });
  expect(LocalStateMsg.decode(loaded).snapshot.buffer).toBe(loaded.buffer);
});
test('router ABI attaches two independent owners and copies physical I/O effects', () => {
  const router = SyncRouter.create(ABI_MAJOR, config(), 0, 0);
  let flags = router.attach('fixture-a', undefined);
  expect(flags & 2).toBe(2);
  const first = decodeOutput(router.takeOutput());
  expect(first.effects.some((e) => e.tag === 11)).toBe(true);
  router.attach('fixture-b', undefined);
  const conn = first.effects.find((e) => e.tag === 11)?.a;
  if (conn === undefined) throw new Error('Missing router connection');
  router.socketOpened(conn, 1, 1);
  const tokens = decodeOutput(router.takeOutput()).effects.filter(
    (e) => e.tag === 1
  );
  expect(tokens.map((e) => new TextDecoder().decode(e.payload))).toEqual([
    'fixture-a',
    'fixture-b',
  ]);
  for (const token of tokens) {
    const doc = new TextDecoder().decode(token.payload);
    router.tokenFetched(doc, token.a, 'fixture-token', 2, 2, 2);
    const sends = decodeOutput(router.takeOutput()).effects.filter(
      (e) => e.tag === 3
    );
    expect(
      sends.some((e) => {
        const message = ToRouter.decode(e.payload);
        return message.isRouterSubscribe() && message.value.docId === doc;
      })
    ).toBe(true);
  }
  router.detach('fixture-a');
  router.detach('fixture-b');
  router.free();
});

test('cold native spans keep parent identity and typing emits no per-keystroke spans', () => {
  const session = EditorSession.create(ABI_MAJOR, config(), 0, 0);
  const records: import('./abi.generated').ITelemetryMsg[] = [];
  const consume = (flags: number) => {
    if (flags & 19)
      for (const effect of decodeOutput(session.takeOutput()).effects)
        if (effect.tag === 8) records.push(TelemetryMsg.decode(effect.payload));
  };
  consume(session.input(SessionInputMsg.encode(emptyInput(0)), 0, 0));
  consume(session.input(SessionInputMsg.encode(emptyInput(1)), 1, 1));
  consume(
    session.input(
      SessionInputMsg.encode({
        ...emptyInput(2),
        editor: EditorInputMsg.fromEditorSetState({
          json: JSON.stringify(state),
        }),
      }),
      2,
      2
    )
  );
  const starts = records.filter((record) => record.kind === 0);
  const open = starts.find((record) => record.name === 'editor.open');
  expect(open).toBeDefined();
  const load = starts.find((record) => record.name === 'state.load');
  expect(load?.parent).toBe(open?.span);
  const ended = new Set(
    records.filter((record) => record.kind === 2).map((record) => record.span)
  );
  expect(starts.every((record) => ended.has(record.span))).toBe(true);
  const key = QueryReplyMsg.decode(
    session.query(QueryMsg.encode({ kind: 4, key: 0, text: 'text', flags: 0 }))
  ).keys[0];
  const before = records.length;
  consume(session.textFromView(key, 'ab', 2, 2, 0, 0, undefined, 3));
  expect(records.length).toBe(before);
  session.free();
});
