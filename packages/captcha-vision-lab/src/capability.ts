/**
 * The per-run capability: a short-lived HMAC-signed claim that one browser
 * session may open one challenge at the registered lab URL, once. The signing
 * secret is generated in-process for each bench run and never leaves it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const CapabilityClaims = z.strictObject({
  capabilityId: z.string(),
  runId: z.string(),
  challengeId: z.string(),
  origin: z.string(),
  path: z.string(),
  sessionNonce: z.string(),
  expiresAt: z.number(),
});
export type CapabilityClaims = z.infer<typeof CapabilityClaims>;

const sign = (secret: Uint8Array, payload: string): Buffer =>
  createHmac('sha256', secret).update(payload).digest();

export const signCapability = (
  secret: Uint8Array,
  claims: CapabilityClaims
): string => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(secret, payload).toString('base64url')}`;
};

/** The claims of a correctly signed token, or undefined for anything else. */
export const verifyCapability = (
  secret: Uint8Array,
  token: string
): CapabilityClaims | undefined => {
  const [payload, signature, ...rest] = token.split('.');
  if (payload === undefined || signature === undefined || rest.length > 0) {
    return undefined;
  }

  const expected = sign(secret, payload);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined;
  }

  const parsed = CapabilityClaims.safeParse(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  );
  return parsed.success ? parsed.data : undefined;
};
