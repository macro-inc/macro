import { describe, expect, it } from 'vitest';
import { type CrmPerson, deduplicatePeople } from './people';

const person = (id: string, overrides: Partial<CrmPerson> = {}): CrmPerson => ({
  id,
  name: id,
  email: `${id}@example.com`,
  companyId: 'company',
  companyName: 'Example',
  hidden: false,
  createdAt: '2025-01-01',
  updatedAt: '2026-01-01',
  firstInteraction: '2025-01-01',
  lastInteraction: '2026-01-01',
  ...overrides,
});

describe('people directory', () => {
  it('collapses representatives that change between pages while preserving aliases and team record IDs', () => {
    const firstPage = [person('new', { email: 'PAT@example.com' })];
    const laterPage = [
      person('old', {
        email: 'pat@example.com',
        lastInteraction: '2025-01-01',
      }),
      person('z', { email: ' pat@example.com ' }),
      person('hidden', {
        email: 'pat@example.com',
        hidden: true,
        lastInteraction: '2027-01-01',
      }),
      person('alias', { email: 'pat+alias@example.com' }),
    ];
    expect(
      deduplicatePeople([...firstPage, ...laterPage]).map((row) => row.id)
    ).toEqual(['z', 'alias']);
    expect(firstPage[0].id).toBe('new');
  });
});
