import { describe, expect, it } from 'vitest';
import { decodeCrmViewParam, encodeCrmViewParam } from './saved-view-codec';
import { parseTeamViews } from './team-view-codec';

describe('CRM saved state boundary', () => {
  it('round trips Unicode and explicit ungrouped layouts', () => {
    const view = {
      kind: 'crm' as const,
      searchText: 'Zoë 日本',
      groupBy: null,
      stageFilter: ['qualified'],
    };
    expect(decodeCrmViewParam(encodeCrmViewParam(view))).toEqual(view);
  });
  it('accepts old snapshots and ignores unknown future fields', () => {
    expect(
      decodeCrmViewParam(btoa(JSON.stringify({ kind: 'crm', future: true })))
    ).toEqual({ kind: 'crm', future: true });
    // Links from before Customers became list-only still open.
    expect(
      decodeCrmViewParam(
        btoa(JSON.stringify({ kind: 'crm', viewMode: 'board' }))
      )
    ).toEqual({ kind: 'crm', viewMode: 'board' });
  });
  it.each([
    { stageFilter: 42 },
    { ownerFilter: [false] },
    { sort: 'updated_at' },
    { clientFilters: [] },
    { clientFilters: { and: 'company-stage' } },
    { searchText: { text: 'acme' } },
  ])('rejects malformed known state %j', (invalid) => {
    expect(
      decodeCrmViewParam(btoa(JSON.stringify({ kind: 'crm', ...invalid })))
    ).toBeUndefined();
  });
  it('rejects broken URLs and malformed saved records', () => {
    expect(decodeCrmViewParam('%invalid')).toBeUndefined();
    expect(
      parseTeamViews([
        null,
        { id: 1 },
        { id: 'saved', name: 'Pipeline', config: { kind: 'crm' } },
      ])
    ).toEqual([{ id: 'saved', name: 'Pipeline', config: { kind: 'crm' } }]);
  });
});
