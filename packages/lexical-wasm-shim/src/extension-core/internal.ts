/** Canonical generic phantom markers contain no fixed editor/node graph. */
export type {
  configTypeSymbol,
  initTypeSymbol,
  LexicalExtensionInternal,
  outputTypeSymbol,
} from 'lexical';

import type {
  AnyLexicalExtension as OriginalAny,
  NormalizedPeerDependency as OriginalPeer,
} from 'lexical';

export type CanonicalPeerKey = Exclude<
  Extract<keyof OriginalPeer<OriginalAny>, symbol>,
  keyof []
>;
