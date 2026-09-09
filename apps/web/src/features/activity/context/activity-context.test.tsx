import { MACRO_SYSTEM_BOT_ID } from '@core/constant/macroSystem';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useBotsQuery = vi.fn();

vi.mock('@queries/bots/bots', () => ({
  useBotsQuery: () => useBotsQuery(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/user', () => ({
  tryMacroId: () => undefined,
  useDisplayName: () => [() => ''],
}));
vi.mock('@property/editor/hooks/useAllProperties', () => ({
  useAllProperties: () => () => [],
}));
vi.mock('@property/hooks', () => ({ usePropertyEntityDisplay: () => ({}) }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));

const { useActivityContext } = await import('./activity-context');

const TEAM_BOT = '11111111-1111-4111-8111-111111111111';
const OTHER_BOT = '22222222-2222-4222-8222-222222222222';

describe('appActivityContext.botName', () => {
  beforeEach(() => {
    useBotsQuery.mockReset();
    useBotsQuery.mockReturnValue({
      isSuccess: true,
      data: [
        { id: TEAM_BOT, name: 'Triage' },
        { id: OTHER_BOT, name: 'Digest' },
      ],
    });
  });

  it('subscribes to the bots list once per consumer, however many bot rows it names', () => {
    createRoot((dispose) => {
      const context = useActivityContext();
      const first = context.botName(() => TEAM_BOT);
      const second = context.botName(() => OTHER_BOT);

      expect(first()).toBe('Triage');
      expect(second()).toBe('Digest');
      expect(first()).toBe('Triage');
      expect(useBotsQuery).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('never fetches the bots list for first-party bots', () => {
    createRoot((dispose) => {
      const context = useActivityContext();
      const name = context.botName(() => MACRO_SYSTEM_BOT_ID);

      expect(name()).toBe('System');
      expect(useBotsQuery).not.toHaveBeenCalled();
      dispose();
    });
  });
});
