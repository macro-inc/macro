// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  $createCodeNode,
  $isCodeHighlightNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code-core';
import { PrismTokenizer, registerCodeHighlighting } from '@lexical/code-prism';
import { createHeadlessEditor } from '@lexical/headless';
import {
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $isTabNode,
  type LexicalNode,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  createNativeCodeTokenProvider,
  NATIVE_CODE_TOKEN_PROFILE,
} from './native-code-tokens';

/**
 * The Source oracle: a headless editor with Source registerCodeHighlighting, so
 * the expected structure is what Source's $codeNodeTransform leaves in the code
 * block after a local edit, not a hand-written token list.
 */
function sourceTokens(language: string, text: string) {
  const editor = createHeadlessEditor({
    namespace: 'source-oracle',
    nodes: [CodeNode, CodeHighlightNode],
    onError: (error) => {
      throw error;
    },
  });
  const release = registerCodeHighlighting(editor);
  editor.update(
    () => {
      const code = $createCodeNode(language);
      if (text) code.append($createTextNode(text));
      $getRoot().clear().append(code);
    },
    { discrete: true }
  );
  const tokens = editor.getEditorState().read(() => {
    const code = $getRoot().getFirstChild();
    if (!$isCodeNode(code)) throw new Error('oracle lost its code node');
    return code.getChildren().map((node: LexicalNode) => {
      if ($isLineBreakNode(node)) return { kind: 'lineBreak' };
      if ($isTabNode(node)) return { kind: 'tab' };
      if ($isCodeHighlightNode(node))
        return {
          kind: 'text',
          text: node.getTextContent(),
          highlightType: node.getHighlightType() ?? null,
        };
      throw new Error('oracle produced ' + node.getType());
    });
  });
  release();
  return tokens;
}

const provider = createNativeCodeTokenProvider();
const tokenize = (language: string, text: string) =>
  JSON.parse(provider('tokenize', language, text, NATIVE_CODE_TOKEN_PROFILE));

const cases: [string, string, string][] = [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source text under test.
  ['nested javascript tokens', 'javascript', 'const s = `a${b + 1}c`;'],
  ['rust', 'rust', 'fn main() {\n    let x = 5;\n}'],
  ['typescript aliases', 'typescript', 'class A<T> implements B {}'],
  ['line breaks and tabs', 'python', 'def f():\n\treturn 1\n'],
  ['diff prefix aliases', 'diff-javascript', '+const a = 1;\n-let b = 2;\n c'],
  ['plain text', 'plaintext', 'just words\nand more'],
  ['empty block', 'javascript', ''],
];
for (const [name, language, text] of cases)
  test(`tokenizes ${name} exactly like Source`, () => {
    const expected = sourceTokens(language, text);
    expect(expected.length).toBeGreaterThanOrEqual(text ? 1 : 0);
    expect(tokenize(language, text)).toEqual({
      kind: 'tokens',
      tokens: expected,
    });
  });

test('reports Source isCodeLanguageLoaded', () => {
  const loaded = (language: string) =>
    JSON.parse(provider('loaded', language, '', NATIVE_CODE_TOKEN_PROFILE));
  expect(loaded('rust')).toEqual({ kind: 'loaded', loaded: true });
  expect(loaded('diff-rust')).toEqual({ kind: 'loaded', loaded: true });
  expect(loaded('cobol')).toEqual({ kind: 'loaded', loaded: false });
  expect(loaded('')).toEqual({ kind: 'loaded', loaded: false });
});

test('throws instead of answering for an unloaded language', () => {
  expect(() =>
    provider('tokenize', 'cobol', 'x', NATIVE_CODE_TOKEN_PROFILE)
  ).toThrow('unloaded code language');
});

test('throws for an unknown profile or op', () => {
  expect(() => provider('loaded', 'rust', '', 'other-profile')).toThrow(
    'Unknown native code token profile'
  );
  expect(() =>
    provider('other' as 'loaded', 'rust', '', NATIVE_CODE_TOKEN_PROFILE)
  ).toThrow('Unknown native code token op');
});

// The native transform fails its update with whatever the tokenizer threw.
for (const [name, thrown] of [
  ['an Error', new Error('tokenizer failed')],
  ['undefined', undefined],
  ['null', null],
  ['a plain object', { reason: 'opaque' }],
] as const)
  test(`rethrows ${name} from the Source tokenizer unchanged`, () => {
    const failing = createNativeCodeTokenProvider({
      $tokenize() {
        throw thrown;
      },
    });
    let caught: unknown = 'nothing thrown';
    try {
      failing('tokenize', 'rust', 'x', NATIVE_CODE_TOKEN_PROFILE);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(thrown);
    // The private editor stays usable after a failure.
    expect(
      JSON.parse(provider('tokenize', 'rust', 'x', NATIVE_CODE_TOKEN_PROFILE))
        .kind
    ).toBe('tokens');
  });

test('tokenizes again after a failed call on the same provider', () => {
  let fail = true;
  const flaky = createNativeCodeTokenProvider({
    $tokenize(code, language) {
      if (fail) throw new Error('once');
      return PrismTokenizer.$tokenize(code, language);
    },
  });
  expect(() =>
    flaky('tokenize', 'rust', 'let x = 1;', NATIVE_CODE_TOKEN_PROFILE)
  ).toThrow('once');
  fail = false;
  expect(
    JSON.parse(
      flaky('tokenize', 'rust', 'let x = 1;', NATIVE_CODE_TOKEN_PROFILE)
    )
  ).toEqual({ kind: 'tokens', tokens: sourceTokens('rust', 'let x = 1;') });
});

// The package does not export its package.json, so the profile cannot be derived at
// runtime; this pins the hand-written profile to the installed version instead.
test('profile names the installed @lexical/code-prism version', () => {
  const entry = createRequire(import.meta.url).resolve('@lexical/code-prism');
  const marker = '/node_modules/@lexical/code-prism/';
  const root = entry.slice(0, entry.lastIndexOf(marker) + marker.length);
  const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  expect(NATIVE_CODE_TOKEN_PROFILE).toBe(`@lexical/code-prism@${version}`);
});
