import { describe, expect, it } from 'vitest';
import { agentSessionSearchFilters } from './agent-session-search-filters';

const nil = '00000000-0000-0000-0000-000000000000';
describe('agent session search scope', () => {
  it('includes sessions in All and Agents and preserves owner narrowing', () => {
    expect(agentSessionSearchFilters({}).include).toBe(true);
    expect(
      agentSessionSearchFilters({ chatOwnerId: ['owner'] }).owners
    ).toEqual(['owner']);
  });
  it.each([
    { chatId: [nil] },
    { chatId: ['legacy-id'] },
    { chatProjectId: ['project'] },
  ])(
    'excludes sessions from other entity and legacy-only scopes: %j',
    (include) => {
      expect(agentSessionSearchFilters(include).ids).toEqual([nil]);
    }
  );
});
