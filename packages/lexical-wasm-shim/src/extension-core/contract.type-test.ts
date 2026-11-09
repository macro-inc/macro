import {
  configExtension as configOriginal,
  defineExtension as defineOriginal,
} from 'lexical';
import type { LexicalEditor as ActualEditor } from '../editor';
import {
  configExtension,
  declarePeerDependency,
  defineExtension,
} from './defineExtension';
import type {
  AnyLexicalExtension,
  LexicalExtensionConfig,
  LexicalExtensionOutput,
  NormalizedPeerDependency,
  OutputExtension,
} from './types';

const concrete = defineExtension({
  name: 'required-number',
  config: { required: 1 },
  build(editor, config) {
    const actual: ActualEditor = editor;
    void actual;
    const required: number = config.required;
    return required;
  },
});
const original = defineOriginal({
  name: 'required-number',
  config: { required: 1 },
  build(_editor, config) {
    const required: number = config.required;
    return required;
  },
});
export const wildcard: AnyLexicalExtension = concrete;
export const output: OutputExtension<number> = concrete;
export const configured = configExtension(concrete, { required: 2 });
export const configuredOriginal = configOriginal(original, { required: 2 });
export const peer: NormalizedPeerDependency<typeof concrete> =
  declarePeerDependency<typeof concrete>('required-number', { required: 2 });
declare const produced: LexicalExtensionOutput<typeof concrete>;
export const numberResult: number = produced;
// @ts-expect-error Concrete output remains number after accepting the public wildcard alias.
export const wrongResult: string = produced;
// @ts-expect-error Concrete configuration does not accept a string.
configExtension(concrete, { required: 'wrong' });
// @ts-expect-error Original rejects the same concrete configuration.
configOriginal(original, { required: 'wrong' });
export type RequiredConfig = LexicalExtensionConfig<typeof concrete>;

import type { NormalizedPeerDependency as OriginalPeer } from 'lexical';
import type { CanonicalPeerKey } from './internal';

type Assert<Condition extends true> = Condition;
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
type ActualPeer = NormalizedPeerDependency<typeof concrete>;
type PinnedPeer = OriginalPeer<typeof original>;
export type PeerKeysMatch = Assert<SameKeys<ActualPeer, PinnedPeer>>;
type InferPeer<Peer> = Peer extends {
  readonly [K in CanonicalPeerKey]?: infer Extension;
}
  ? Extension
  : never;
export type ActualPhantom = Assert<
  InferPeer<ActualPeer> extends typeof concrete ? true : false
>;
export type CompleteActualPhantom = Assert<
  typeof concrete extends InferPeer<ActualPeer> ? true : false
>;
export type PinnedPhantom = Assert<
  InferPeer<PinnedPeer> extends typeof original ? true : false
>;
export type CompletePinnedPhantom = Assert<
  typeof original extends InferPeer<PinnedPeer> ? true : false
>;

import type {
  configTypeSymbol,
  LexicalExtensionInternal as PinnedInternal,
} from 'lexical';
import type { LexicalExtensionInternal as ActualInternal } from './internal';
export type MarkerKeysMatch = Assert<
  SameKeys<
    ActualInternal<{ required: number }, number, undefined>,
    PinnedInternal<{ required: number }, number, undefined>
  >
>;
type ConfigAtCanonicalMarker = NonNullable<(typeof concrete)[configTypeSymbol]>;
export type CanonicalConfigInference = Assert<
  ConfigAtCanonicalMarker extends { required: number } ? true : false
>;
export type CompleteCanonicalConfigInference = Assert<
  { required: number } extends ConfigAtCanonicalMarker ? true : false
>;
