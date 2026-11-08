import { readFileSync } from 'node:fs';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { beforeAll, expect, test } from 'vitest';
import {
  EditorSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { Mirror } from './mirror';
import type { ViewSink } from './port';
import { SessionPort } from './session-port';

beforeAll(() =>
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  })
);
function setup(debug: boolean) {
  const session = EditorSession.create(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'view-fixture',
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
  let now = 0;
  let mirror: Mirror | undefined;
  let acknowledgements = 0;
  let corrupt = false;
  let flags = -1;
  const sink: ViewSink = {
    apply(words, strings, effects) {
      if (effects.some((effect) => effect.kind === 8))
        mirror?.initialize(words, strings);
      else mirror?.apply(words, strings);
    },
    acknowledgeText(input) {
      acknowledgements++;
      if (!corrupt) mirror?.acknowledgeText(input.key, input.text);
    },
    acknowledgeSelection() {},
    text(key) {
      return mirror?.node(key)?.text ?? null;
    },
  };
  const executor = {
    session,
    now: () => now,
    run(call: () => number, after?: (flags: number) => void) {
      flags = call();
      if (flags & (1 | 2 | 8 | 16)) {
        const out = decodeOutput(session.takeOutput());
        sink.apply(out.view, out.strings, out.viewEffects);
      }
      after?.(flags);
    },
  };
  const port = new SessionPort(executor, sink, debug);
  mirror = new Mirror(port.types());
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(0)), now, now)
  );
  now++;
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(1)), now, now)
  );
  now++;
  port.setState(
    JSON.stringify({
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
    })
  );
  const key = [...mirror.values()].find((node) => node.kind === 'text')?.key;
  if (key === undefined) throw new Error('Missing fixture text');
  const input = (text: string) => ({
    key,
    text,
    anchorOffset: text.length,
    focusOffset: text.length,
  });
  return {
    session,
    port,
    mirror,
    key,
    input,
    flags: () => flags,
    acknowledgements: () => acknowledgements,
    corrupt: () => {
      corrupt = true;
    },
    advance: (milliseconds = 1) => (now += milliseconds),
    executor,
  };
}
test('every TextFromView reconciles mirror text with the actual Rust node', () => {
  const s = setup(true);
  try {
    for (const text of ['ab', 'abc', 'abcd', 'ab😀']) {
      s.advance();
      s.port.textFromView(s.input(text));
      expect(s.mirror.node(s.key)?.text).toBe(s.session.nodeText(s.key));
    }
    expect(s.acknowledgements()).toBeGreaterThan(0);
    // Losing permission restores the actual stored text, even with no commit.
    s.executor.run(() => s.session.authorization(true, false, false, 8, 8));
    s.port.textFromView(s.input('rejected'));
    expect(s.flags()).not.toBe(0);
    expect(s.mirror.node(s.key)?.text).toBe(s.session.nodeText(s.key));
    expect(s.mirror.node(s.key)?.text).not.toBe('rejected');
  } finally {
    s.session.free();
  }
});
test('debug assertion catches a dropped acknowledgement after a zero result', () => {
  const s = setup(true);
  try {
    s.port.textFromView(s.input('ab'));
    s.corrupt();
    expect(() => s.port.textFromView(s.input('abc'))).toThrow(
      'TextFromView mirror divergence'
    );
    expect(s.flags()).toBe(0);
  } finally {
    s.session.free();
  }
});
test('production TextFromView has no per-node query crossing', () => {
  const s = setup(false);
  try {
    s.session.nodeText = () => {
      throw new Error('Per-node crossing');
    };
    s.port.textFromView(s.input('ab'));
    s.port.textFromView(s.input('abc'));
    expect(s.flags()).toBe(0);
    expect(s.mirror.node(s.key)?.text).toBe('abc');
  } finally {
    s.session.free();
  }
});

test('invalid DOM UTF-16 is rejected with a real repair and the debug check still runs', () => {
  const s = setup(true);
  try {
    s.port.textFromView(s.input('a\ud800'));
    expect(s.flags() & 16).toBe(16);
    expect(s.mirror.node(s.key)?.text).toBe('a');
    expect(s.session.nodeText(s.key)).toBe('a');
    expect(s.acknowledgements()).toBe(0);
  } finally {
    s.session.free();
  }
});
test('non-text and stale text keys cannot remove live mirror nodes', () => {
  const s = setup(true);
  try {
    s.port.textFromView({ ...s.input('invalid'), key: 0 });
    expect(s.mirror.node(0)?.kind).toBe('root');
    expect(s.mirror.node(s.key)?.text).toBe('a');
    s.port.setState(
      JSON.stringify({
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
                  text: 'fresh',
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      })
    );
    expect(s.mirror.node(s.key)).toBeNull();
    s.port.textFromView(s.input('stale'));
    expect(s.mirror.node(s.key)).toBeNull();
    expect(s.mirror.node(0)?.kind).toBe('root');
  } finally {
    s.session.free();
  }
});

test('normalized composition text uses real Rust ops rather than local acknowledgement', () => {
  const s = setup(true);
  try {
    s.port.textFromView({ ...s.input('a\u200b'), compositionEnd: true });
    expect(s.flags()).not.toBe(0);
    expect(s.acknowledgements()).toBe(0);
    expect(s.mirror.node(s.key)?.text).toBe('a');
    expect(s.session.nodeText(s.key)).toBe('a');
  } finally {
    s.session.free();
  }
});
test('an exact edit with other output still carries authoritative text', () => {
  const s = setup(true);
  try {
    s.advance(30);
    s.executor.run(() => s.session.tick(s.executor.now(), Date.now()));
    s.advance();
    s.port.textFromView(s.input('ab'));
    expect(s.flags()).not.toBe(0);
    expect(s.acknowledgements()).toBe(0);
    expect(s.mirror.node(s.key)?.text).toBe('ab');
  } finally {
    s.session.free();
  }
});

test('type flags, command propagation and cold initialize use the paired ABI', () => {
  const s = setup(true);
  try {
    expect(
      s.port.types().find((row) => row.name === 'text')?.flags
        ?.canInsertTextBefore
    ).toBe(true);
    expect(s.port.command(CommandCode.ClearHistory)).toBe(true);
    s.port.textFromView(s.input('ab'));
    s.port.initialize();
    expect(s.mirror.node(s.key)?.text).toBe('ab');
    expect(s.session.nodeText(s.key)).toBe('ab');
  } finally {
    s.session.free();
  }
});
