import type { EditorConfig } from '../editor';
import { foreignHooks } from '../hooks.generated';
import type { ShimBackend } from './index';

export type BackendFactory = (config: EditorConfig) => ShimBackend;
let factory: BackendFactory | undefined;
let hookIndex: readonly string[] | undefined;

/** Bind only after the selected engine has initialized; imports never initialize WASM. */
export function bindBackendFactory(
  next: BackendFactory,
  hooks: readonly string[]
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
  hookIndex = Object.freeze([...hooks]);
}

export function createBackend(config: EditorConfig): ShimBackend {
  if (factory === undefined)
    throw new Error('Lexical engine has not been initialized');
  return factory(config);
}

export function foreignHookIndex(): readonly string[] {
  if (hookIndex === undefined)
    throw new Error('Lexical engine has not been initialized');
  return hookIndex;
}
