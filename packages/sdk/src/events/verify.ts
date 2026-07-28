/**
 * Verify a Macro webhook signature.
 *
 * Macro signs deliveries as `X-Macro-Signature: v1=<hex>` where the digest is
 * HMAC-SHA256 over `"{timestamp}.{rawBody}"` keyed by the webhook's signing
 * secret (see the `X-Macro-Timestamp` header).
 */
export async function verifySignature(opts: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(opts.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${opts.timestamp}.${opts.rawBody}`),
  );

  const hexDigest = new Uint8Array(digest).toHex();

  return `v1=${hexDigest}` === opts.signature;
}
