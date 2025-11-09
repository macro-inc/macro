export function bytesEqual(
  a: Uint8Array | ArrayBuffer,
  b: Uint8Array | ArrayBuffer
): boolean {
  const viewA = a instanceof Uint8Array ? a : new Uint8Array(a);
  const viewB = b instanceof Uint8Array ? b : new Uint8Array(b);

  if (viewA.length !== viewB.length) return false;

  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
}
