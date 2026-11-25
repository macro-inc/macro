import type { EntityData } from '@entity';
import { expect, it, vi } from 'vitest';
import { mergeCandidates } from './crm-merge';

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@queries/team/teams', () => ({ useIsTeamAdmin: () => () => true }));

const company = (id: string, hidden = false) =>
  ({
    type: 'crm_company',
    id,
    name: `Company ${id}`,
    hidden,
    domains: [{ domain: `${id}.example.com` }],
  }) as unknown as EntityData;

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
