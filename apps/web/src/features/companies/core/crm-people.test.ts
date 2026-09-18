import { describe, expect, it } from 'vitest';
import { type CrmPerson, filterAndSortPeople } from './crm-people';

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
  it('searches contact names, emails and companies without exposing hidden contacts', () => {
    const rows = [
      person('Ada'),
      person('B', { companyName: 'Ada Labs' }),
      person('C', { email: 'ada@other.com' }),
      person('D', { name: 'Ada', hidden: true }),
    ];
    expect(
      filterAndSortPeople(rows, ' ADA ', 'name', false).map((row) => row.id)
    ).toEqual(['Ada', 'B', 'C']);
    expect(rows).toHaveLength(4);
  });
  it('orders actual interaction dates across companies and places missing dates last', () => {
    const rows = [
      person('old', { lastInteraction: '2024-09-16' }),
      person('unknown', { lastInteraction: '' }),
      person('new', { lastInteraction: '2026-09-16' }),
    ];
    expect(
      filterAndSortPeople(rows, '', 'lastInteraction', true).map(
        (row) => row.id
      )
    ).toEqual(['new', 'old', 'unknown']);
  });
  it('sorts unnamed contacts by email and leaves the input order unchanged', () => {
    const rows = [person('z', { name: null }), person('a')];
    expect(
      filterAndSortPeople(rows, '', 'name', false).map((row) => row.id)
    ).toEqual(['a', 'z']);
    expect(rows.map((row) => row.id)).toEqual(['z', 'a']);
  });
});
