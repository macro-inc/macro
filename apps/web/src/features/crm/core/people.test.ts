import { describe, expect, it } from 'vitest';
import {
  type CrmPerson,
  deduplicatePeople,
  filterAndSortPeople,
} from './people';

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
