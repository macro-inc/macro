function normalizeBase64String(input: string): string {
  const replaced = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (replaced.length % 4)) % 4;
  return replaced + '='.repeat(padding);
}

export function decodeBase64Utf8(input: string): string {
  try {
    const normalized = normalizeBase64String(input);
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return input;
  }
}
