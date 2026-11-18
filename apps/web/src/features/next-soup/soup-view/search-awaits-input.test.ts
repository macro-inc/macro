import { describe, expect, it } from 'vitest';
import { searchAwaitsInput } from './search-awaits-input';

const preset = {
  filters: { include: { crmCompanyId: ['nil'] } },
  clientFilters: { and: ['search-supported'] },
};

const idle = {
  text: '',
  state: { include: { crmCompanyId: ['nil'] }, exclude: {} },
  activeFilterIds: ['search-supported'],
  assigneeCount: 0,
  preset,
};

describe('searchAwaitsInput', () => {
  it('waits with no text and only the default filters', () => {
    expect(searchAwaitsInput(idle)).toBe(true);
    expect(searchAwaitsInput({ ...idle, text: '   ' })).toBe(true);
  });

  it('searches once there is text', () => {
    expect(searchAwaitsInput({ ...idle, text: 'plan' })).toBe(false);
  });

  it('lists results for a filter beyond the defaults', () => {
    expect(
      searchAwaitsInput({
        ...idle,
        activeFilterIds: ['search-supported', 'document'],
      })
    ).toBe(false);
    expect(
      searchAwaitsInput({
        ...idle,
        state: {
          include: { crmCompanyId: ['nil'], projectId: ['project'] },
          exclude: {},
        },
      })
    ).toBe(false);
    expect(searchAwaitsInput({ ...idle, assigneeCount: 1 })).toBe(false);
  });
});
