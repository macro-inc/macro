/** Decode standard or URL-safe base64 into bytes. */
export function decodeBase64Bytes(input: string): Uint8Array {
  const replaced = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (replaced.length % 4)) % 4;
  const binary = atob(replaced + '='.repeat(padding));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
