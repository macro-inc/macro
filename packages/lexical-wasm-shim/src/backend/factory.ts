import type { ShimBackend } from './index';

export type BackendFactory = (config: unknown) => ShimBackend;
let factory: BackendFactory | undefined;

/** Bind only after the selected engine has initialized; imports never initialize WASM. */
export function bindBackendFactory(next: BackendFactory): void {
  factory = next;
}

export function createBackend(config: unknown): ShimBackend {
  if (factory === undefined)
    throw new Error('Lexical engine has not been initialized');
  return factory(config);
}
