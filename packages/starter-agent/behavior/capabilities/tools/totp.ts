/** The current TOTP code for a base32 secret (RFC 6238: SHA1, 30 seconds). */

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const step = 30;

export const base32 = (secret: string): Uint8Array<ArrayBuffer> => {
  const bits = [...secret.replace(/[\s=]/g, '').toUpperCase()]
    .map((character) => {
      const value = alphabet.indexOf(character);
      if (value < 0) throw new Error('secret is not base32');
      return value.toString(2).padStart(5, '0');
    })
    .join('');
  return Uint8Array.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2))
  );
};

export const totp = async (
  secret: string,
  at: Temporal.Instant,
  digits = 6
): Promise<string> => {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(
    0,
    BigInt(Math.floor(at.epochMilliseconds / 1000 / step))
  );
  const key = await crypto.subtle.importKey(
    'raw',
    base32(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const digest = new DataView(
    await crypto.subtle.sign('HMAC', key, counter.buffer)
  );
  const offset = digest.getUint8(digest.byteLength - 1) & 15;
  return String(
    (digest.getUint32(offset) & 0x7fffffff) % 10 ** digits
  ).padStart(digits, '0');
};
