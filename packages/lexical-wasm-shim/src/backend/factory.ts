import type { NativePluginManifest } from '@macro-inc/collaboration/session/native-plugins';
import type {
  PreparedEditorRegisteredNodes,
  RegistryPreparation,
} from '../configuration/registered-nodes';
import type { CreateEditorArgs, EditorConfig } from '../editor';
import { foreignHooks } from '../hooks.generated';
import type { ShimBackend } from './index';

export type BackendFactory = (
  config: CreateEditorArgs,
  normalized: EditorConfig,
  registered: PreparedEditorRegisteredNodes,
  nativePlugins: NativePluginManifest
) => ShimBackend;
let factory: BackendFactory | undefined;
let hookIndex: readonly string[] | undefined;
let prepareRegistry:
  | ((input: RegistryPreparation) => PreparedEditorRegisteredNodes)
  | undefined;

/** Bind only after the selected engine has initialized; imports never initialize WASM. */
export function bindBackendFactory(
  next: BackendFactory,
  hooks: readonly string[],
  prepare: (input: RegistryPreparation) => PreparedEditorRegisteredNodes
): void {
  if (
    hooks.length !== foreignHooks.length ||
    hooks.some((name, index) => name !== foreignHooks[index].name)
  ) {
    throw new Error(
      'Native foreign hook index differs from the generated inventory'
    );
  }
  factory = next;
  prepareRegistry = prepare;
  hookIndex = Object.freeze([...hooks]);
}

/** Bind the real class registry preparer after the cold class graph is loaded. */
export function prepareRegisteredNodes(
  input: RegistryPreparation
): PreparedEditorRegisteredNodes {
  if (prepareRegistry === undefined)
    throw new Error('Lexical engine has not been initialized');
  return prepareRegistry(input);
}

export function createBackend(
  config: CreateEditorArgs,
  normalized: EditorConfig,
  registered: PreparedEditorRegisteredNodes,
  nativePlugins: NativePluginManifest
): ShimBackend {
  if (factory === undefined)
    throw new Error('Lexical engine has not been initialized');
  return factory(config, normalized, registered, nativePlugins);
}

export function foreignHookIndex(): readonly string[] {
  if (hookIndex === undefined)
    throw new Error('Lexical engine has not been initialized');
  return hookIndex;
}
