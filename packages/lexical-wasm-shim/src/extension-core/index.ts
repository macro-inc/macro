/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

export {
  configExtension,
  declarePeerDependency,
  defineExtension,
} from './defineExtension';
export type {
  configTypeSymbol,
  initTypeSymbol,
  LexicalExtensionInternal,
  outputTypeSymbol,
} from './internal';
export { safeCast } from './safeCast';
export { shallowMergeConfig } from './shallowMergeConfig';
export type {
  AnyLexicalExtension,
  AnyLexicalExtensionArgument,
  AnyNormalizedLexicalExtensionArgument,
  ExtensionBuildState,
  ExtensionConfigBase,
  ExtensionInitState,
  ExtensionRegisterState,
  InitialEditorConfig,
  InitialEditorStateType,
  LexicalEditorWithDispose,
  LexicalExtension,
  LexicalExtensionArgument,
  LexicalExtensionConfig,
  LexicalExtensionDependency,
  LexicalExtensionInit,
  LexicalExtensionName,
  LexicalExtensionOutput,
  NormalizedLexicalExtensionArgument,
  NormalizedPeerDependency,
  OutputComponentExtension,
  OutputExtension,
} from './types';
