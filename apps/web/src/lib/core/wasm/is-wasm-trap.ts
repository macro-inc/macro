/** Whether an error came from a trapped (panicked) wasm instance. */
export function isWasmTrap(error: unknown): boolean {
  if (
    typeof WebAssembly !== 'undefined' &&
    error instanceof WebAssembly.RuntimeError
  )
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unreachable|recursive use of an object|already borrowed|already mutably borrowed/i.test(
    message
  );
}
