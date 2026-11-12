/** @vitest-environment jsdom */
// Control for provider/scoped-callback nesting: a scoped Enter callback's code command reaches the
// transform; this pins whether the fenced provider runs while a native callback scope is issued.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  EditorInputMsg,
  QueryMsg,
  QueryReplyMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput, Flag } from '@macro-inc/collaboration/session/output';
import { beforeAll, expect, test } from 'vitest';
import * as native from '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { NativeEnterDispatcher } from '../native-enter';

beforeAll(() => {
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});

const NONE = {
  kind: 0,
  anchor: { key: 0, offset: 0, type: 0 },
  focus: { key: 0, offset: 0, type: 0 },
  dirty: false,
  backward: false,
};
const drain = (session: native.EditorSession, flags: number) => {
  if (flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error))
    return decodeOutput(session.takeOutput());
};

test('a scoped Enter dispatch reaches the fenced provider only after its scope closes', () => {
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const calls: { scoped: boolean; inCallback: boolean; op: string }[] = [];
  let inCallback = false;
  const rejected: string[] = [];
  let ownerId = 0n;
  let armed = false;
  let session: native.EditorSession | undefined;
  const provider = dispatcher.fenceCodeTokenProvider((...args) => {
    if (armed) {
      calls.push({
        scoped: dispatcher.current(ownerId) !== undefined,
        inCallback,
        op: args[0],
      });
      try {
        session?.serializedState();
      } catch (error) {
        rejected.push(error instanceof Error ? error.message : String(error));
      }
    }
    return JSON.stringify({ kind: 'loaded', loaded: false });
  });
  session = native.EditorSession.createMacroWithNamespace(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'code-token-scoped',
      session: '00000000-0000-0000-0000-000000000003',
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
    }),
    0,
    0,
    'code-token-scoped',
    undefined,
    undefined,
    provider,
    'native-fixture'
  );
  const own = session;
  for (const kind of [0, 1])
    drain(own, own.input(SessionInputMsg.encode(emptyInput(kind)), kind, kind));
  drain(
    own,
    own.input(
      SessionInputMsg.encode({
        ...emptyInput(2),
        editor: EditorInputMsg.fromEditorSetState({
          json: JSON.stringify({
            root: {
              type: 'root',
              version: 1,
              children: [
                {
                  type: 'custom-code',
                  version: 1,
                  language: 'plaintext',
                  children: [{ type: 'text', version: 1, text: 'let a' }],
                },
              ],
            },
          }),
        }),
      }),
      2,
      2
    )
  );
  const codeKey = QueryReplyMsg.decode(
    own.query(
      QueryMsg.encode({ kind: 4, key: 0, text: 'custom-code', flags: 0 })
    )
  ).keys[0];
  if (codeKey === undefined) throw new Error('Actual native code key missing');
  const generation = 0;
  ownerId = dispatcher.owner(own);
  const remove = dispatcher.register(
    own,
    ownerId,
    () => {
      armed = true;
      // A scoped application command that dirties the code node. This qualifies transport only:
      // an ordinary text edit does not reach the provider natively (A activation blocker, A2).
      inCallback = true;
      dispatcher.dispatchScoped(
        ownerId,
        EditorInputMsg.fromEditorApplication({
          name: 'group-b.code',
          json: JSON.stringify({
            action: 'language',
            key: codeKey,
            language: 'rust',
          }),
          generation,
          selection: {
            kind: 0,
            anchor: NONE.anchor,
            focus: NONE.focus,
            nodes: [],
            table: 0,
            dirty: false,
          },
          keyboard: false,
          key: '',
          mods: 0,
          code: 0,
        })
      );
      inCallback = false;
      return true;
    },
    4
  );
  try {
    drain(own, own.viewCommandEnter(3, 3));
    armed = false;
    expect(dispatcher.hasFailures(ownerId)).toBe(false);
    expect(JSON.parse(own.serializedState()).root.children[0].language).toBe(
      'rust'
    );
    // Reachable, but transforms run at the outer commit: the provider runs after the callback
    // returned, with no issued scope, and receivers still reject through the provider fence.
    expect(calls).toEqual([{ scoped: false, inCallback: false, op: 'loaded' }]);
    expect(rejected).toEqual([
      'Native session receiver call during scoped callback or cleanup',
    ]);
  } finally {
    remove();
    own.free();
  }
});
