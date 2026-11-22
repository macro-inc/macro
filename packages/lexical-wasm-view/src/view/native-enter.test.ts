/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
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
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { NativeEnterDispatcher } from './native-enter';

beforeAll(() => {
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});

function createSession() {
  const session = native.EditorSession.createMacro(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'enter-dispatcher',
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
    }),
    0,
    0
  );
  for (const kind of [0, 1]) {
    session.input(SessionInputMsg.encode(emptyInput(kind)), kind, kind);
    decodeOutput(session.takeOutput());
  }
  return session;
}

function drain(session: native.EditorSession, flags: number) {
  if (flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error))
    return decodeOutput(session.takeOutput());
}

test('fixed vertical callbacks use actual pending plans for all five stopping block types', () => {
  const dispatcher = NativeEnterDispatcher.forModule(native);
  expect(dispatcher.supportsBlockNavigation).toBe(true);
  for (const kind of [
    'image',
    'video',
    'horizontalrule',
    'database-query',
    'document-card',
  ]) {
    const session = createSession();
    const owner = dispatcher.owner(session);
    drain(
      session,
      session.input(
        SessionInputMsg.encode({
          ...emptyInput(2),
          editor: EditorInputMsg.fromEditorSetState({
            json: JSON.stringify({
              root: {
                type: 'root',
                $: { documentMetadata: { version: 11 } },
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', text: 'Before' }],
                  },
                  {
                    type: kind,
                    displayMode: 'table',
                    queryId: 'query',
                    prompt: 'Count entries',
                  },
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', text: 'end' }],
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
    const matches = QueryReplyMsg.decode(
      session.query(
        QueryMsg.encode({ kind: 2, key: 0, text: 'Before', flags: 0 })
      )
    );
    const text = matches.points[0]?.key;
    if (text === undefined) throw new Error('Missing actual text key');
    const original = session.serializedState();
    const remove = dispatcher.register(
      session,
      owner,
      (event) => {
        expect(event?.key).toBe('ArrowDown');
        const plan = dispatcher.prepareBlockNavigation(owner);
        if (plan === 0n) return false;
        const block = dispatcher.blockNavigationBlock(owner, plan);
        if (block === undefined)
          throw new Error('Expected issued geometry block');
        expect(dispatcher.pendingText(owner, block)).toBe('Before');
        expect(() => session.serializedState()).toThrow();
        const handled = dispatcher.completeBlockNavigation(
          owner,
          plan,
          [0, 20, 0, 20, 20]
        );
        expect(handled).toBe(true);
        const selected = dispatcher.pendingSelection(owner);
        expect(selected.kind).toBe(3);
        const target = selected.nodes[0];
        if (target === undefined)
          throw new Error('Missing actual selected block');
        expect(JSON.parse(dispatcher.pendingOwnJSON(owner, target)).type).toBe(
          kind
        );
        expect(() => dispatcher.completeBlockNavigation(owner, plan)).toThrow();
        return handled;
      },
      1,
      undefined,
      'ArrowDown'
    );
    try {
      const first = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      drain(
        session,
        dispatcher.withKeyboardEvent(owner, first, () =>
          session.keyDown(40, 0, 0, 'ArrowDown', text, 6, 0, text, 6, 0, 0, 3)
        )
      );
      const second = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      const output = drain(
        session,
        dispatcher.withKeyboardEvent(owner, second, () =>
          session.keyDown(40, 0, 0, 'ArrowDown', 0, 0, 0, 0, 0, 0, 1, 4)
        )
      );
      const selection = output?.viewEffects.findLast(
        (effect) => effect.kind === 6 && effect.code === 0
      )?.selection;
      expect(selection?.kind).toBe(2);
      expect(selection?.anchor.type).toBe(1);
      expect(selection?.anchor.offset).toBe(0);
      expect(selection?.focus).toEqual(selection?.anchor);
      expect(session.serializedState()).toBe(original);
      expect(dispatcher.hasFailures(owner)).toBe(false);
    } finally {
      remove();
      dispatcher.releaseOwner(session, owner);
      session.free();
    }
  }
});

test('same-bucket cleanup retains the real native snapshot callback lease', () => {
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const session = createSession();
  const owner = dispatcher.owner(session);
  const order: string[] = [];
  let removeLater = () => {};
  const removeFirst = dispatcher.register(
    session,
    owner,
    (event) => {
      expect(event).toBeNull();
      order.push('first');
      removeLater();
      return false;
    },
    4
  );
  removeLater = dispatcher.register(
    session,
    owner,
    () => {
      order.push('later');
      return true;
    },
    4
  );
  try {
    drain(session, session.viewCommandEnter(2, 2));
    expect(order).toEqual(['first', 'later']);
    drain(session, session.viewCommandEnter(3, 3));
    expect(order).toEqual(['first', 'later', 'first']);
    expect(dispatcher.hasFailures(owner)).toBe(false);
  } finally {
    removeFirst();
    removeLater();
    session.free();
  }
});

test('actual keyboard metadata uses its admitted event and nested Enter uses null', () => {
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const session = createSession();
  const owner = dispatcher.owner(session);
  const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 });
  const payloads: (KeyboardEvent | null)[] = [];
  const remove = dispatcher.register(
    session,
    owner,
    (payload) => {
      payloads.push(payload);
      if (payload !== null) {
        const current = dispatcher.current(owner);
        if (!current) throw new Error('Missing actual native callback scope');
        expect(() => session.effectiveAccess()).toThrow(
          'Native session receiver call during scoped callback'
        );
        expect(native.viewCommandScopeEnter(current.scope)).toBe(true);
      }
      return true;
    },
    4
  );
  try {
    const flags = dispatcher.withKeyboardEvent(owner, event, () =>
      session.keyDown(13, 0, 0, 'Enter', 0, 0, 0, 0, 0, 0, 1, 2)
    );
    drain(session, flags);
    expect(payloads).toEqual([event, null]);
    expect(dispatcher.current(owner)).toBeUndefined();
    expect(dispatcher.hasFailures(owner)).toBe(false);
  } finally {
    remove();
    session.free();
  }
});

test('scoped operations read the actual pending text and selection before publication', () => {
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const session = createSession();
  const owner = dispatcher.owner(session);
  const state = {
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'draft' }],
        },
      ],
    },
  };
  drain(
    session,
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
  const matches = QueryReplyMsg.decode(
    session.query(QueryMsg.encode({ kind: 2, key: 0, text: 'draft', flags: 0 }))
  );
  const key = matches.points[0]?.key;
  if (key === undefined) throw new Error('Actual native text key missing');
  const remove = dispatcher.register(
    session,
    owner,
    () => {
      dispatcher.setPendingSelection(owner, {
        kind: 2,
        anchor: { key, offset: 5, type: 0 },
        focus: { key, offset: 5, type: 0 },
        nodes: [],
        table: 0,
        dirty: true,
      });
      expect(dispatcher.pendingSelection(owner).anchor.offset).toBe(5);
      expect(dispatcher.pendingText(owner, key)).toBe('draft');
      dispatcher.dispatchScoped(
        owner,
        EditorInputMsg.fromEditorCommand({
          command: CommandCode.InsertText,
          a: 0,
          b: 0,
          text: '!',
          selection: {
            kind: 0,
            anchor: { key: 0, offset: 0, type: 0 },
            focus: { key: 0, offset: 0, type: 0 },
            nodes: [],
            table: 0,
            dirty: false,
          },
          target: {
            kind: 0,
            anchor: { key: 0, offset: 0, type: 0 },
            focus: { key: 0, offset: 0, type: 0 },
            dirty: false,
            backward: false,
          },
          characterTarget: {
            kind: 0,
            anchor: { key: 0, offset: 0, type: 0 },
            focus: { key: 0, offset: 0, type: 0 },
            dirty: false,
            backward: false,
          },
        })
      );
      expect(dispatcher.pendingText(owner, key)).toBe('draft!');
      expect(JSON.parse(dispatcher.pendingOwnJSON(owner, key))).toMatchObject({
        text: 'draft!',
      });
      expect(dispatcher.pendingSelection(owner).anchor.offset).toBe(6);
      return true;
    },
    4
  );
  try {
    drain(session, session.viewCommandEnter(3, 3));
    expect(dispatcher.hasFailures(owner)).toBe(false);
    expect(session.nodeText(key)).toBe('draft!');
    expect(() => dispatcher.pendingText(owner, key)).toThrow(
      'Native Enter operation lacks an issued scope'
    );
  } finally {
    remove();
    session.free();
  }
});

test.each([undefined, null, { reason: 'opaque' }])(
  'reported native callback retains the exact original cause %j',
  (cause) => {
    const dispatcher = NativeEnterDispatcher.forModule(native);
    const session = createSession();
    const owner = dispatcher.owner(session);
    const remove = dispatcher.register(
      session,
      owner,
      () => {
        throw cause;
      },
      4
    );
    try {
      session.viewCommandEnter(2, 2);
      const lease = session.takeViewCommandFailure();
      if (!lease) throw new Error('Missing actual native failure lease');
      expect(session.takeViewCommandFailure()).toBeUndefined();
      const output = decodeOutput(session.takeOutput());
      expect(lease.current).toBe(true);
      expect(lease.effectOrdinals().length).toBeGreaterThan(0);
      for (const ordinal of lease.effectOrdinals())
        expect([2, 6]).toContain(output.viewEffects[ordinal].kind);
      const failure = dispatcher.failure(owner, lease.invocation, lease.scope);
      expect(failure).toBeDefined();
      expect(failure?.error).toBe(cause);
      lease.free();
      dispatcher.clearFailures(owner);
      expect(dispatcher.hasFailures(owner)).toBe(false);
    } finally {
      remove();
      session.free();
    }
  }
);

test.each(['owner', 'registration'] as const)(
  'raw %s keeps zero-output text and both selection ABIs without opt-in',
  (mode) => {
    const dispatcher = NativeEnterDispatcher.forModule(native);
    const session = createSession();
    let owner: bigint | undefined;
    let cleanup: (() => void) | undefined;
    try {
      if (mode === 'owner')
        expect(session.viewCommandOwner()).toBeGreaterThan(0n);
      else {
        owner = dispatcher.owner(session);
        cleanup = dispatcher.register(session, owner, () => false, 4);
      }
      drain(
        session,
        session.input(
          SessionInputMsg.encode({
            ...emptyInput(2),
            editor: EditorInputMsg.fromEditorSetState({
              json: JSON.stringify({
                root: {
                  type: 'root',
                  children: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', text: 'a' }],
                    },
                  ],
                },
              }),
            }),
          }),
          3,
          3
        )
      );
      const point = QueryReplyMsg.decode(
        session.query(QueryMsg.encode({ kind: 2, key: 0, text: 'a', flags: 0 }))
      ).points[0];
      if (!point) throw new Error('Missing actual raw native text');
      // Establish view ownership through its genuine first Diff, as legacy does.
      drain(
        session,
        session.textFromView(point.key, 'aa', 2, 2, 0, 0, undefined, 4)
      );

      expect(
        session.textFromView(point.key, 'ab', 2, 2, 0, 0, undefined, 4)
      ).toBe(0);
      expect(session.takeOutput().length).toBe(0);
      expect(
        session.selectionFromView(point.key, 1, 0, point.key, 1, 0, 5)
      ).toBe(0);
      expect(session.takeOutput().length).toBe(0);
      expect(
        session.input(
          SessionInputMsg.encode({
            ...emptyInput(2),
            editor: EditorInputMsg.fromEditorSelection({
              selection: {
                kind: 2,
                anchor: { key: point.key, offset: 2, type: 0 },
                focus: { key: point.key, offset: 2, type: 0 },
                nodes: [],
                table: 0,
                dirty: false,
              },
              change: {},
            }),
          }),
          6,
          6
        )
      ).toBe(0);
      expect(session.takeOutput().length).toBe(0);
    } finally {
      cleanup?.();
      if (owner !== undefined) dispatcher.releaseOwner(session, owner);
      session.free();
    }
  }
);
