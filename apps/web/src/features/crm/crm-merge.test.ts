import type { EntityData } from '@entity';
import { beforeEach, expect, it, vi } from 'vitest';
import { companyMerge, mergeCandidates, openMergeCompanies } from './crm-merge';

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

beforeEach(() => {
  access.allowed = true;
  companyMerge.close();
});

it('offers a merge only for companies, all live, at most eleven', () => {
  expect(mergeCandidates([company('a'), company('b')])).toEqual([
    { id: 'a', name: 'Company a', domains: ['a.example.com'] },
    { id: 'b', name: 'Company b', domains: ['b.example.com'] },
  ]);
  expect(mergeCandidates([company('a')])).toHaveLength(1);
  expect(mergeCandidates([company('a'), company('b', true)])).toEqual([]);
  expect(
    mergeCandidates([company('a'), { type: 'document', id: 'd' } as EntityData])
  ).toEqual([]);
  expect(
    mergeCandidates(Array.from({ length: 12 }, (_, i) => company(`c${i}`)))
  ).toEqual([]);
});

it('hands the merge to the layout’s dialog, which keeps it while closing', () => {
  const onMerged = vi.fn();
  const companies = mergeCandidates([company('a'), company('b')]);

  openMergeCompanies(companies, onMerged);
  expect(companyMerge.open()).toBe(true);
  expect(companyMerge.request()).toEqual({ companies, onMerged });

  companyMerge.close();
  expect(companyMerge.open()).toBe(false);
  expect(companyMerge.request()?.companies).toBe(companies);

  const next = mergeCandidates([company('c')]);
  openMergeCompanies(next);
  expect(companyMerge.open()).toBe(true);
  expect(companyMerge.request()?.companies).toBe(next);
});

it('opens nothing once CRM access is denied', () => {
  access.allowed = false;
  openMergeCompanies(mergeCandidates([company('a'), company('b')]));
  expect(companyMerge.open()).toBe(false);
});
