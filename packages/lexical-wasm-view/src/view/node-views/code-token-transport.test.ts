/** @vitest-environment jsdom */
// Dormant transport for the host code tokenizer (commit B): a real local code edit reaches the JS
// provider through the model transform. Not Prism parity; the provider here is a native fixture.
import {
  Access,
  CommandCode,
  EditorInputMsg,
  type IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { DecodedViewEffect } from '@macro-inc/collaboration/session/output';
import { afterAll, beforeAll, expect, test } from 'vitest';
import * as nativeModule from '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { selectionMessage } from '../session-port';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';

const nativeArtifactProfile =
  process.env.NATIVE_SESSION_GUARD_PROFILE ?? 'production';
if (
  nativeArtifactProfile !== 'production' &&
  nativeArtifactProfile !== 'preview'
)
  throw new Error('Unknown native session artifact profile');

const productionArtifactJs = process.env.NATIVE_SESSION_PRODUCTION_ARTIFACT_JS;

beforeAll(() => {
  initializeNativeSurfaceTests();
  otherSurface = nativeSurface(Access.Edit);
});
afterAll(() => otherSurface.close());

type Provider = (language: string, text: string, profile: string) => string;
type Session = nativeModule.EditorSession;

// Captured after the fixture module's guard is installed (first fenced surface below).
let cachedSerializedState: (this: Session) => string;
let otherSurface: ReturnType<typeof nativeSurface>;
const other = () => otherSurface;
const SENTINEL = 'sentinel-content-must-not-leak';
const HOST = 'host code tokenizer failed';

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

const loadedReply = (loaded: boolean) =>
  JSON.stringify({ kind: 'loaded', loaded });

function surfaceWith(
  provider: Provider,
  loaded: (language: string) => string = () => loadedReply(true),
  bindCauses = false
) {
  // Native setState runs the code transform (Source setEditorState does not); keep setup untokenized.
  let armed = false;
  const fixture = nativeSurface(
    Access.Edit,
    {},
    {
      provider: (op, language, text, profile) => {
        if (!armed) return loadedReply(false);
        return op === 'loaded'
          ? loaded(language)
          : provider(language, text, profile);
      },
      profile: 'native-fixture',
      bindCauses,
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
  cachedSerializedState ??=
    nativeModule.EditorSession.prototype.serializedState;
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

test('typing inside a code block reaches the provider and retokenizes', () => {
  const calls: [string, string, string][] = [];
  const { fixture, code } = surfaceWith((language, text, profile) => {
    calls.push([language, text, profile]);
    return fixtureReply(text);
  });
  try {
    const textKey = fixture.view.node(code.key)?.children[0];
    if (textKey === undefined) throw new Error('Missing native code text');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: textKey, type: 'text', offset: 5 },
      focus: { key: textKey, type: 'text', offset: 5 },
    });
    fixture.port.command(CommandCode.InsertText, 0, 0, ' b');
    expect(calls).toContainEqual(['plaintext', 'let a b', 'native-fixture']);
    // Same shape as the Source oracle (code-leaf-source.test.ts) with the same split.
    const shape = (fixture.view.node(code.key)?.children ?? []).map((key) => {
      const node = fixture.view.node(key);
      return [node?.type, node?.text, node?.props().highlightType ?? null];
    });
    expect(shape).toEqual([
      ['code-highlight', 'let', 'word'],
      ['code-highlight', ' ', null],
      ['code-highlight', 'a', 'word'],
      ['code-highlight', ' ', null],
      ['code-highlight', 'b', 'word'],
    ]);
  } finally {
    fixture.close();
  }
});

test('the language check runs before tokenizing and a not-loaded language never tokenizes', () => {
  const tokenized: string[] = [];
  const checked: string[] = [];
  const { fixture, setLanguage, childTypes } = surfaceWith(
    (_, text) => {
      tokenized.push(text);
      return fixtureReply(text);
    },
    (language) => {
      checked.push(language);
      return loadedReply(language !== 'cobol');
    }
  );
  try {
    setLanguage('cobol');
    expect(checked).toContain('cobol');
    expect(tokenized).toEqual([]);
    expect(childTypes()).toEqual(['text']);
  } finally {
    fixture.close();
  }
});

test.each([
  [
    'a throwing check',
    () => {
      throw new Error(SENTINEL);
    },
  ],
  ['a non-boolean reply', () => JSON.stringify({ kind: 'loaded', loaded: 1 })],
  ['a tokens reply', () => fixtureReply('let a')],
])(
  '%s fails the edit with a content-free host error before tokenizing',
  (_, loaded) => {
    const tokenized: string[] = [];
    const { fixture, setLanguage, childTypes } = surfaceWith((_, text) => {
      tokenized.push(text);
      return fixtureReply(text);
    }, loaded);
    try {
      try {
        setLanguage('rust');
      } catch {
        // Asserted through the reported failure below.
      }
      expect(fixture.errors).toEqual([HOST]);
      expect(JSON.stringify(fixture.errors)).not.toContain(SENTINEL);
      expect(tokenized).toEqual([]);
      expect(childTypes()).toEqual(['text']);
    } finally {
      fixture.close();
    }
  }
);

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
    expect(fixture.errors).toEqual([HOST]);
    expect(JSON.stringify([errors.map(String), fixture.errors])).not.toContain(
      SENTINEL
    );
    // The fence depth is reset after the throw.
    expect(typeof fixture.session.serializedState()).toBe('string');
  } finally {
    fixture.close();
  }
});

test.each([
  ['non-string reply', () => ({ kind: 'tokens', tokens: [] })],
  ['invalid JSON', () => '{'],
  ['extra key', () => JSON.stringify({ kind: 'tokens', tokens: [], extra: 1 })],
  ['loaded reply', () => loadedReply(true)],
])('a %s leaves the block untokenized', (_, provider) => {
  const { fixture, setLanguage, childTypes } = surfaceWith(
    provider as unknown as Provider
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

const GUARD = 'Native session receiver call during scoped callback or cleanup';

// Raw (unfenced) reentry corrupts wasm-bindgen state; recorded as RED evidence in
// B-raw-reentry-RED.log, unsupported per the provider contract. These run through the fence.
test.each([
  ['an ordinary read', (own: Session) => own.serializedState()],
  ['an ordinary mutation', (own: Session) => own.input(new Uint8Array(), 0, 0)],
  ['free()', (own: Session) => own.free()],
  [
    'a cached receiver captured after installation',
    (own: Session) => cachedSerializedState.call(own),
  ],
  [
    'a static factory',
    () =>
      nativeModule.EditorSession.createMacroWithNamespace(
        0,
        new Uint8Array(),
        0,
        0,
        'reentry'
      ),
  ],
  ['another session', () => other().session.serializedState()],
] as const)(
  'reentering through %s inside the provider is rejected before wasm-bindgen; the session stays usable and freeable',
  (_, reenter) => {
    const observed: string[] = [];
    let armedReentry = true;
    let thrown: Error | undefined;
    const holder: { session?: Session } = {};
    const { fixture, setLanguage, childTypes } = surfaceWith((_, text) => {
      if (armedReentry && holder.session) {
        armedReentry = false;
        try {
          reenter(holder.session);
          observed.push('no error');
        } catch (error) {
          observed.push(error instanceof Error ? error.message : String(error));
          thrown = new Error(SENTINEL);
          throw thrown;
        }
      }
      return fixtureReply(text);
    });
    holder.session = fixture.session;
    const outer: string[] = [];
    try {
      setLanguage('rust');
    } catch (error) {
      outer.push(String(error));
    }
    expect(observed).toEqual([GUARD]);
    expect(fixture.errors).toEqual([HOST]);
    expect(JSON.stringify([outer, fixture.errors])).not.toContain(SENTINEL);
    expect(childTypes()).toEqual(['text']);
    // The rejected reentry leaves the outer entry's cause intact, takeable only by its own pair.
    const failure = fixture.session.takeCodeTokenFailure();
    if (!failure) throw new Error('missing code token failure');
    const [cause] = failure.causes();
    expect(
      fixture.session.takeCodeTokenCause(failure.entry + 1n, cause)
    ).toBeUndefined();
    expect(fixture.session.takeCodeTokenCause(failure.entry, cause)?.[0]).toBe(
      thrown
    );
    // The fence depth is reset: an ordinary call and the next edit both succeed.
    expect(typeof fixture.session.serializedState()).toBe('string');
    setLanguage('javascript');
    expect(childTypes()).toEqual([
      'code-highlight',
      'code-highlight',
      'code-highlight',
    ]);
    fixture.close();
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
        provider: () => JSON.stringify({ kind: 'loaded', loaded: false }),
        profile: undefined as unknown as string,
      }
    )
  ).toThrow();
});

test.runIf(
  nativeArtifactProfile === 'production' || productionArtifactJs !== undefined
)('the production artifact ships no dev-probes registry export', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const glue = readFileSync(
    productionArtifactJs ??
      resolve(
        import.meta.dirname,
        '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js'
      ),
    'utf8'
  );
  expect(glue).not.toContain('debugCodeTokenProviders');
});

test.each([
  ['an Error', new Error(SENTINEL)],
  ['undefined', undefined],
  ['null', null],
  ['a plain object', { content: SENTINEL }],
])(
  'a thrown %s is taken back by identity through its reported (entry, cause), once',
  (_, value) => {
    const { fixture, setLanguage } = surfaceWith(() => {
      throw value;
    });
    try {
      try {
        setLanguage('rust');
      } catch {
        // Asserted through the reported failure below.
      }
      expect(fixture.errors).toEqual([HOST]);
      const failure = fixture.session.takeCodeTokenFailure();
      if (!failure) throw new Error('missing code token failure');
      expect(fixture.session.takeCodeTokenFailure()).toBeUndefined();
      expect(failure.causes()).toHaveLength(1);
      expect(failure.effectOrdinals()).toHaveLength(1);
      const [cause] = failure.causes();
      expect(
        fixture.session.takeCodeTokenCause(failure.entry, cause + 1)
      ).toBeUndefined();
      expect(
        fixture.session.takeCodeTokenCause(failure.entry + 1n, cause)
      ).toBeUndefined();
      const taken = fixture.session.takeCodeTokenCause(failure.entry, cause);
      // Presence of the element, not its value, tells a thrown undefined from no cause.
      expect(taken).toHaveLength(1);
      expect(taken?.[0]).toBe(value);
      expect(
        fixture.session.takeCodeTokenCause(failure.entry, cause)
      ).toBeUndefined();
      expect(fixture.session.codeTokenCausesDropped()).toBe(0);
    } finally {
      fixture.close();
    }
  }
);

test('an unrelated tokenizer failure records no cause', () => {
  const { fixture, setLanguage } = surfaceWith(() => '{');
  try {
    try {
      setLanguage('rust');
    } catch {
      // Asserted through the reported failure below.
    }
    expect(fixture.errors).toEqual([HOST]);
    expect(fixture.session.takeCodeTokenFailure()).toBeUndefined();
    expect(fixture.session.codeTokenCausesDropped()).toBe(0);
  } finally {
    fixture.close();
  }
});

test('an untaken cause is retired and counted when the next entry begins; later throws are still recorded', () => {
  const values = Array.from(
    { length: 9 },
    (_, index) => new Error(String(index))
  );
  let next = 0;
  const { fixture, setLanguage } = surfaceWith(() => {
    throw values[next++];
  });
  try {
    const failures = [];
    for (const _ of values) {
      try {
        setLanguage('rust');
      } catch {
        // Every edit fails; asserted below.
      }
      failures.push(fixture.session.takeCodeTokenFailure());
    }
    expect(next).toBe(9);
    expect(failures.every((failure) => failure?.causes().length === 1)).toBe(
      true
    );
    // Entries 1-8 were never taken; each is retired when the next entry begins.
    expect(fixture.session.codeTokenCausesDropped()).toBe(8);
    const [first, last] = [failures[0], failures[8]];
    if (!first || !last) throw new Error('missing failures');
    expect(
      fixture.session.takeCodeTokenCause(first.entry, first.causes()[0])
    ).toBeUndefined();
    expect(
      fixture.session.takeCodeTokenCause(last.entry, last.causes()[0])?.[0]
    ).toBe(values[8]);
  } finally {
    fixture.close();
  }
});

// Carrier E3: setState runs the code transform in a follow-up update (the id-assigning round);
// its failure, reported as FollowUpFailed (kind 6, code 10), carries the original thrown value,
// takeable at that effect's ordinal and bound onto it like a main-update error.
test.each([false, true])(
  'a tokenizer throw inside a follow-up update carries its original value (bound=%s)',
  (bindCauses) => {
    const thrown = new Error(SENTINEL);
    const { fixture } = surfaceWith(
      () => {
        throw thrown;
      },
      () => loadedReply(true),
      bindCauses
    );
    const applied: IViewEffectMsg[][] = [];
    const apply = fixture.view.apply.bind(fixture.view);
    fixture.view.apply = (words, strings, effects = []) => {
      applied.push(effects);
      apply(words, strings, effects);
    };
    try {
      try {
        fixture.port.setState(
          JSON.stringify({
            root: {
              type: 'root',
              version: 1,
              children: [
                {
                  type: 'custom-code',
                  version: 1,
                  language: 'rust',
                  children: [
                    { type: 'text', version: 1, text: 'fn main() {}' },
                  ],
                },
              ],
            },
          })
        );
      } catch {
        // Asserted below.
      }
      const effects = applied.at(-1) ?? [];
      const failedAt = effects.findIndex(
        (effect) => effect.kind === 6 && effect.code === 10
      );
      expect(failedAt).toBeGreaterThanOrEqual(0);
      if (bindCauses) {
        // The executor took the record and put the value on the follow-up failure effect.
        expect(fixture.session.takeCodeTokenFailure()).toBeUndefined();
        const effect: DecodedViewEffect = effects[failedAt];
        expect(effect.codeTokenCause?.value).toBe(thrown);
      } else {
        const failure = fixture.session.takeCodeTokenFailure();
        if (!failure) throw new Error('missing code token failure');
        expect([...failure.effectOrdinals()]).toEqual([failedAt]);
        const [cause] = failure.causes();
        expect(
          fixture.session.takeCodeTokenCause(failure.entry, cause)?.[0]
        ).toBe(thrown);
      }
      expect(fixture.session.codeTokenCausesDropped()).toBe(0);
    } finally {
      fixture.close();
    }
  }
);

// GUARD, not a RED: the decoded ordinal must index the error effect. A Diff before the error
// in one output needs tx.preceding (core.rs:246/251/273, a multi-item input flushing between
// items), which no current JS input produces; the host test
// thrown_ordinals_use_the_decoded_tag16_numbering is the RED for the tag-16 numbering.
test('guard: the failure ordinal indexes the decoded error effect', () => {
  const { fixture, code } = surfaceWith(() => {
    throw new Error(SENTINEL);
  });
  const applied: IViewEffectMsg[][] = [];
  const apply = fixture.view.apply.bind(fixture.view);
  fixture.view.apply = (words, strings, effects = []) => {
    applied.push(effects);
    apply(words, strings, effects);
  };
  try {
    const text = fixture.view.node(code.key)?.children[0];
    const generation = fixture.view.mirror.keyGeneration;
    if (text === undefined || generation === null)
      throw new Error('Missing native code text');
    try {
      fixture.port.input(
        EditorInputMsg.fromEditorApplication({
          name: 'group-b.code',
          json: JSON.stringify({
            action: 'language',
            key: code.key,
            language: 'rust',
          }),
          generation,
          selection: selectionMessage({
            kind: 'range',
            anchor: { key: text, offset: 1, type: 'text' },
            focus: { key: text, offset: 1, type: 'text' },
          }),
          keyboard: false,
          key: '',
          mods: 0,
          code: 0,
        })
      );
    } catch {
      // Asserted below.
    }
    expect(fixture.errors).toEqual([HOST]);
    const failure = fixture.session.takeCodeTokenFailure();
    if (!failure) throw new Error('missing code token failure');
    const effects = applied.at(-1) ?? [];
    const [ordinal] = failure.effectOrdinals();
    expect(effects[ordinal]?.kind).toBe(2);
    expect(effects[ordinal]?.text).toBe(HOST);
  } finally {
    fixture.close();
  }
});

// Phase 2: the view error raised for a tokenizer throw carries the original value as its own
// `cause`, bound by the executor right after the output is taken.
test.each([
  ['an Error', new Error(SENTINEL)],
  ['undefined', undefined],
  ['null', null],
  ['a plain object', { content: SENTINEL }],
])('the view error for a thrown %s has it as its own cause', (_, value) => {
  const { fixture, setLanguage } = surfaceWith(
    () => {
      throw value;
    },
    () => loadedReply(true),
    true
  );
  try {
    const raised: unknown[] = [];
    try {
      setLanguage('rust');
    } catch (error) {
      raised.push(error);
    }
    expect(fixture.errors).toEqual([HOST]);
    const [error] = raised;
    if (!(error instanceof Error)) throw new Error('missing raised error');
    expect(error.message).toBe(HOST);
    // Own presence tells a thrown undefined from no cause.
    expect(Object.hasOwn(error, 'cause')).toBe(true);
    expect(error.cause).toBe(value);
    expect(Object.keys(error)).not.toContain('cause');
    // Bound once: nothing is left to take.
    expect(fixture.session.takeCodeTokenFailure()).toBeUndefined();
    expect(fixture.session.codeTokenCausesDropped()).toBe(0);
  } finally {
    fixture.close();
  }
});

test('the view error for an unrelated tokenizer failure has no cause', () => {
  const { fixture, setLanguage } = surfaceWith(
    () => '{',
    () => loadedReply(true),
    true
  );
  try {
    const raised: unknown[] = [];
    try {
      setLanguage('rust');
    } catch (error) {
      raised.push(error);
    }
    expect(fixture.errors).toEqual([HOST]);
    const [error] = raised;
    if (!(error instanceof Error)) throw new Error('missing raised error');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  } finally {
    fixture.close();
  }
});
