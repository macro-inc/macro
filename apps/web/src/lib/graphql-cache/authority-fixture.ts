import type { CacheAuthority } from './authority';

/** Fixed permission owner for transport suites; authority races have separate tests. */
export const TEST_AUTHORITY_GENERATION = '00000000-0000-4000-8000-000000000098';
export const testAuthority = (identity: string): CacheAuthority => ({
  identity,
  account: null,
  generation: TEST_AUTHORITY_GENERATION,
  policy: 'none',
  ready: true,
});
export function withoutAuthorityEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const { authorityGeneration: _, ...rest } = value as Record<string, unknown>;
  return rest;
}
