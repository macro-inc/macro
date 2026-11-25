import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { signCapability, verifyCapability } from '../src/capability.ts';

const SECRET = new Uint8Array(32).fill(7);

const signRaw = (payload: string): string => {
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
};

test('a correctly signed token carries its claims', () => {
  const claims = {
    capabilityId: 'capability-1',
    runId: 'run-1',
    challengeId: 'challenge-1',
    origin: 'http://127.0.0.1:47831',
    path: '/lab/shapes-quiz',
    sessionNonce: 'session-1',
    expiresAt: 1_000,
  };

  expect(verifyCapability(SECRET, signCapability(SECRET, claims))).toEqual(
    claims
  );
});

test('a correctly signed but malformed payload is refused, not thrown', () => {
  expect(verifyCapability(SECRET, signRaw('not json'))).toBeUndefined();
  expect(verifyCapability(SECRET, signRaw('{"runId": 1}'))).toBeUndefined();
  expect(verifyCapability(SECRET, signRaw('null'))).toBeUndefined();
});
