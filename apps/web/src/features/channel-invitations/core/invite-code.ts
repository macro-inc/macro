/** Encode all 128 UUID bits as a 22-character URL-safe invitation code. */
export function encodeInviteCode(uuid: string): string {
  const hex = uuid.replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error('Invalid invitation code');
  const bytes = hex.match(/.{2}/g) ?? [];
  return btoa(
    String.fromCharCode(...bytes.map((byte) => Number.parseInt(byte, 16)))
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** Invalid short codes never reach the join endpoint. */
export function decodeInviteCode(code: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return undefined;
  const bytes = atob(code.replaceAll('-', '+').replaceAll('_', '/') + '==');
  const hex = Array.from(bytes, (byte) =>
    byte.charCodeAt(0).toString(16).padStart(2, '0')
  ).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return encodeInviteCode(uuid) === code ? uuid : undefined;
}

/** Only channel invitations are accepted as post-login destinations. */
export function channelInviteRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\/(?:app\/)?c\/([A-Za-z0-9_-]{22})$/.exec(value);
  if (!match || !decodeInviteCode(match[1])) return undefined;
  return `/c/${match[1]}`;
}
