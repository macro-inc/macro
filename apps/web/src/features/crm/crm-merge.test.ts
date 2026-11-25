import type { EntityData } from '@entity';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  mergeActionLabel,
  mergeCandidates,
  openMerge,
  recordMerge,
} from './crm-merge';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('@queries/team/teams', () => ({ useIsTeamAdmin: () => () => true }));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => access.allowed,
}));

const company = (id: string, hidden = false) =>
  ({
    type: 'crm_company',
    id,
    name: `Company ${id}`,
    hidden,
    domains: [{ domain: `${id}.example.com` }],
  }) as unknown as EntityData;

const person = (id: string, hidden = false, email: string | null = null) =>
  ({
    type: 'crm_contact',
    id,
    name: `Person ${id}`,
    hidden,
    email: email ?? `${id}@example.com`,
    companyName: 'Acme',
  }) as unknown as EntityData;

beforeEach(() => {
  access.allowed = true;
  recordMerge.close();
});

it('offers a merge only for companies, all live, at most eleven', () => {
  expect(mergeCandidates([company('a'), company('b')])).toEqual({
    recordType: 'company',
    records: [
      { id: 'a', name: 'Company a', identifiers: ['a.example.com'] },
      { id: 'b', name: 'Company b', identifiers: ['b.example.com'] },
    ],
  });
  expect(mergeCandidates([company('a')])?.records).toHaveLength(1);
  expect(mergeCandidates([company('a'), company('b', true)])).toBeUndefined();
  expect(
    mergeCandidates([company('a'), { type: 'document', id: 'd' } as EntityData])
  ).toBeUndefined();
  expect(
    mergeCandidates(Array.from({ length: 12 }, (_, i) => company(`c${i}`)))
  ).toBeUndefined();
});

it('offers a merge of people, all live, never people with companies', () => {
  expect(mergeCandidates([person('a'), person('b')])).toEqual({
    recordType: 'contact',
    records: [
      {
        id: 'a',
        name: 'Person a',
        identifiers: ['a@example.com'],
        company: 'Acme',
      },
      {
        id: 'b',
        name: 'Person b',
        identifiers: ['b@example.com'],
        company: 'Acme',
      },
    ],
  });
  expect(mergeCandidates([person('a'), person('b', true)])).toBeUndefined();
  expect(mergeCandidates([person('a'), company('b')])).toBeUndefined();
  expect(
    mergeCandidates(Array.from({ length: 12 }, (_, i) => person(`p${i}`)))
  ).toBeUndefined();
});

it('names the row menu’s merge for one record or several', () => {
  const label = (entities: EntityData[]) =>
    mergeActionLabel(mergeCandidates(entities)!);
  expect(label([company('a')])).toBe('Merge with…');
  expect(label([company('a'), company('b')])).toBe('Merge companies');
  expect(label([person('a')])).toBe('Merge with…');
  expect(label([person('a'), person('b')])).toBe('Merge people');
});

it('hands the merge to the layout’s dialog, which keeps it while closing', () => {
  const onMerged = vi.fn();
  const selection = mergeCandidates([company('a'), company('b')])!;

  openMerge(selection, onMerged);
  expect(recordMerge.open()).toBe(true);
  expect(recordMerge.request()).toEqual({ ...selection, onMerged });

  recordMerge.close();
  expect(recordMerge.open()).toBe(false);
  expect(recordMerge.request()?.records).toBe(selection.records);

  const next = mergeCandidates([person('c')])!;
  openMerge(next);
  expect(recordMerge.open()).toBe(true);
  expect(recordMerge.request()?.recordType).toBe('contact');
  expect(recordMerge.request()?.records).toBe(next.records);
});

it('opens nothing once CRM access is denied', () => {
  access.allowed = false;
  openMerge(mergeCandidates([person('a'), person('b')])!);
  expect(recordMerge.open()).toBe(false);
});
