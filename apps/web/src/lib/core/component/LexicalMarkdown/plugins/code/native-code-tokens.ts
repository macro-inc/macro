import {
  $createCodeNode,
  $isCodeHighlightNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code-core';
import { isCodeLanguageLoaded, PrismTokenizer } from '@lexical/code-prism';
import { createHeadlessEditor } from '@lexical/headless';
import type { NativeCodeTokenProvider } from '@macro-inc/lexical-wasm-view/view/native-enter';
import {
  $createTextNode,
  $isLineBreakNode,
  $isTabNode,
  type LexicalNode,
} from 'lexical';

/** Identity of the tokenizer configuration: Source's pinned Prism package. A test pins it to the installed version. */
export const NATIVE_CODE_TOKEN_PROFILE = '@lexical/code-prism@0.45.0';

type TokenDescriptor =
  | { kind: 'text'; text: string; highlightType: string | null }
  | { kind: 'lineBreak' }
  | { kind: 'tab' };

function descriptor(node: LexicalNode): TokenDescriptor {
  if ($isLineBreakNode(node)) return { kind: 'lineBreak' };
  if ($isTabNode(node)) return { kind: 'tab' };
  if ($isCodeHighlightNode(node))
    return {
      kind: 'text',
      text: node.getTextContent(),
      highlightType: node.getHighlightType() ?? null,
    };
  throw new Error('Unexpected Source code token node ' + node.getType());
}

/**
 * Source code highlighting as the native host tokenizer: `loaded` is Source
 * `isCodeLanguageLoaded`; `tokenize` runs Source `PrismTokenizer.$tokenize`
 * (Prism plus `$mapTokensToLexicalStructure`, including diff languages) in a
 * private headless editor and reports the nodes it creates. A failure throws;
 * the native transform then fails its update, as a throwing Source transform
 * does.
 */
export function createNativeCodeTokenProvider(
  tokenizer: Pick<typeof PrismTokenizer, '$tokenize'> = PrismTokenizer
): NativeCodeTokenProvider {
  // Lexical reports an internal update error here, then restores and commits
  // its previous state; rethrowing from onError would skip that restore.
  const lexicalErrors: unknown[] = [];
  const editor = createHeadlessEditor({
    namespace: 'native-code-tokens',
    nodes: [CodeNode, CodeHighlightNode],
    onError: (error) => {
      lexicalErrors.push(error);
    },
  });
  return (op, language, text, profile) => {
    if (profile !== NATIVE_CODE_TOKEN_PROFILE)
      throw new Error('Unknown native code token profile');
    if (op === 'loaded')
      return JSON.stringify({
        kind: 'loaded',
        loaded: isCodeLanguageLoaded(language),
      });
    if (op !== 'tokenize') throw new Error('Unknown native code token op');
    if (!isCodeLanguageLoaded(language))
      throw new Error('Tokenize requested for an unloaded code language');
    let tokens: TokenDescriptor[] | undefined;
    let failure: { error: unknown } | undefined;
    lexicalErrors.length = 0;
    editor.update(
      () => {
        try {
          const code = $createCodeNode(language);
          if (text) code.append($createTextNode(text));
          tokens = tokenizer.$tokenize(code, language).map(descriptor);
        } catch (error) {
          failure = { error };
        }
      },
      { discrete: true }
    );
    if (failure) throw failure.error;
    if (lexicalErrors.length) throw lexicalErrors[0];
    // A nested update of this editor is queued, not run; Lexical also drops
    // non-Error throws from its own update steps.
    if (!tokens) throw new Error('Source tokenizer produced no result');
    return JSON.stringify({ kind: 'tokens', tokens });
  };
}
