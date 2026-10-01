import { describe, expect, it } from 'vitest';
import { sameRecordScope } from './record';

describe('sameRecordScope', () => {
  const acme = { type: 'company' as const, id: 'c1', domains: ['acme.com'] };

  it('treats a rebuilt scope with the same record as the same', () => {
    expect(sameRecordScope(acme, { ...acme, domains: ['acme.com'] })).toBe(
      true
    );
    expect(sameRecordScope(undefined, undefined)).toBe(true);
  });

  it('tells apart other records, domains and emails', () => {
    expect(sameRecordScope(acme, { ...acme, id: 'c2' })).toBe(false);
    expect(sameRecordScope(acme, { ...acme, domains: ['acme.io'] })).toBe(
      false
    );
    expect(sameRecordScope(acme, undefined)).toBe(false);
    const ada = { type: 'contact' as const, id: 'p1', email: 'ada@acme.com' };
    expect(sameRecordScope(ada, { ...ada, email: 'ada@acme.io' })).toBe(false);
    expect(sameRecordScope(ada, { ...acme, id: 'p1' })).toBe(false);
  });
});
