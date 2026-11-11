/** @vitest-environment jsdom */
// Dormant transport for the host code tokenizer (commit B): a real local code edit reaches the JS
// provider through the model transform. Not Prism parity; the provider here is a native fixture.
import {
  Access,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import { selectionMessage } from '../session-port';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';

beforeAll(initializeNativeSurfaceTests);

type Provider = (language: string, text: string, profile: string) => unknown;
const SENTINEL = 'sentinel-content-must-not-leak';

const fixtureReply = (text: string) =>
  JSON.stringify({
    kind: 'tokens',
    tokens: text
      .split(/( )/)
      .filter(Boolean)
      .map((part) => ({
        kind: 'text',
        text: part,
        highlightType: part === ' ' ? null : 'word',
      })),
  });

function surfaceWith(provider: Provider) {
  // Native setState runs the code transform (Source setEditorState does not); keep setup untokenized.
  let armed = false;
  const fixture = nativeSurface(
    Access.Edit,
    {},
    {
      provider: (language, text, profile) =>
        armed
          ? provider(language, text, profile)
          : JSON.stringify({ kind: 'notLoaded' }),
      profile: 'native-fixture',
    }
  );
  fixture.port.setState(
    JSON.stringify({
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
    })
  );
  const code = [...fixture.view.mirror.values()].find(
    (n) => n.type === 'custom-code'
  );
  if (!code) throw new Error('Missing native code block');
  armed = true;
  const setLanguage = (language: string) => {
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing native generation');
    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.code',
        json: JSON.stringify({ action: 'language', key: code.key, language }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
  };
  const childTypes = () =>
    (fixture.view.node(code.key)?.children ?? []).map(
      (key) => fixture.view.node(key)?.type
    );
  return { fixture, setLanguage, childTypes, code };
}

test('a local code edit stores host tokens through the transport', () => {
  const calls: [string, string, string][] = [];
  const { fixture, setLanguage, childTypes } = surfaceWith(
    (language, text, profile) => {
      calls.push([language, text, profile]);
      return fixtureReply(text);
    }
  );
  try {
    setLanguage('rust');
    expect(calls).toContainEqual(['rust', 'let a', 'native-fixture']);
    expect(childTypes()).toEqual([
      'code-highlight',
      'code-highlight',
      'code-highlight',
    ]);
  } finally {
    fixture.close();
  }
});

test('a throwing provider fails the edit with a content-free host error', () => {
  const errors: unknown[] = [];
  const { fixture, setLanguage, childTypes } = surfaceWith(() => {
    throw new Error(SENTINEL);
  });
  try {
    try {
      setLanguage('rust');
    } catch (error) {
      errors.push(error);
    }
    expect(childTypes()).toEqual(['text']);
    expect(JSON.stringify(errors.map(String))).not.toContain(SENTINEL);
  } finally {
    fixture.close();
  }
});

test.each([
  ['non-string reply', () => ({ kind: 'notLoaded' })],
  ['invalid JSON', () => '{'],
  ['extra key', () => JSON.stringify({ kind: 'notLoaded', extra: 1 })],
])('a %s leaves the block untokenized', (_, provider) => {
  const { fixture, setLanguage, childTypes } = surfaceWith(
    provider as Provider
  );
  try {
    try {
      setLanguage('rust');
    } catch {
      // The typed failure path; asserted through the unchanged model below.
    }
    expect(childTypes()).toEqual(['text']);
  } finally {
    fixture.close();
  }
});

test.each(['mutate', 'read'] as const)(
  'reentering the session (%s) inside the provider fails the edit; usable, but the leaked borrow blocks free()',
  (kind) => {
    const observed: string[] = [];
    let reenter = true;
    const outer: string[] = [];
    const holder: { fixture?: ReturnType<typeof surfaceWith>['fixture'] } = {};
    const { fixture, setLanguage, childTypes } = surfaceWith((_, text) => {
      if (reenter && holder.fixture) {
        reenter = false;
        try {
          if (kind === 'mutate')
            holder.fixture.session.input(new Uint8Array(), 0, 0);
          else if (kind === 'read') holder.fixture.session.serializedState();
          observed.push('no error');
        } catch (error) {
          observed.push(String(error));
          throw error;
        }
      }
      return fixtureReply(text);
    });
    holder.fixture = fixture;
    try {
      try {
        setLanguage('rust');
      } catch (error) {
        outer.push(String(error));
      }
      expect(observed).toHaveLength(1);
      expect(observed[0]).not.toBe('no error');
      expect(childTypes()).toEqual(['text']);
      setLanguage('javascript');
      expect(childTypes()).toEqual([
        'code-highlight',
        'code-highlight',
        'code-highlight',
      ]);
      // Finding: wasm-bindgen rejects the reentrant call by throwing through Rust, which leaks the
      // reentrant call's borrow; the session stays usable but can no longer be freed.
      expect(() => fixture.close()).toThrow(
        'attempted to take ownership of Rust value while it was borrowed'
      );
    } finally {
      fixture.root.remove();
    }
  }
);

test('two sessions each call only their own provider', () => {
  const first: string[] = [];
  const second: string[] = [];
  const a = surfaceWith((language, text) => {
    first.push(language);
    return fixtureReply(text);
  });
  const b = surfaceWith((language, text) => {
    second.push(language);
    return fixtureReply(text);
  });
  try {
    a.setLanguage('rust');
    expect(first).toContain('rust');
    expect(second).toEqual([]);
    b.setLanguage('go');
    expect(second).toContain('go');
    expect(first).not.toContain('go');
  } finally {
    a.fixture.close();
    b.fixture.close();
  }
});

test('a provider without a profile is rejected at construction', () => {
  expect(() =>
    nativeSurface(
      Access.Edit,
      {},
      {
        provider: () => JSON.stringify({ kind: 'notLoaded' }),
        profile: undefined as unknown as string,
      }
    )
  ).toThrow();
});

// Finding, not a guarantee: wasm-bindgen's JS free() zeroes the wrapper pointer before Rust rejects a
// free of a borrowed session, so a provider that calls free() mid-edit poisons the JS wrapper. The
// provider contract gives it no session reference; this pins the actual failure shape.
test('free() inside the provider is rejected but poisons the JS wrapper (wasm-bindgen)', () => {
  const observed: string[] = [];
  const holder: { fixture?: ReturnType<typeof surfaceWith>['fixture'] } = {};
  let reenter = true;
  const { fixture, setLanguage } = surfaceWith((_, text) => {
    if (reenter && holder.fixture) {
      reenter = false;
      try {
        holder.fixture.session.free();
      } catch (error) {
        observed.push(String(error));
      }
    }
    return fixtureReply(text);
  });
  holder.fixture = fixture;
  expect(() => setLanguage('rust')).toThrow('null pointer passed to rust');
  expect(observed).toEqual([
    'Error: attempted to take ownership of Rust value while it was borrowed',
  ]);
  fixture.root.remove();
});

test('the production artifact ships no dev-probes registry export', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const glue = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js'
    ),
    'utf8'
  );
  expect(glue).not.toContain('debugCodeTokenProviders');
});
