import { MACRO_SYSTEM_BOT_ID } from '@core/constant/macroSystem';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useBotsQuery = vi.fn();
const useDatabaseDetailQuery = vi.fn();
const usePropertyEntityDisplay = vi.fn(
  (_entityId: () => string, _entityType: () => string) => ({})
);

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
vi.mock('@property/hooks', () => ({
  usePropertyEntityDisplay: (
    entityId: () => string,
    entityType: () => string
  ) => usePropertyEntityDisplay(entityId, entityType),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabaseDetailQuery: (databaseId: () => string | undefined) =>
    useDatabaseDetailQuery(databaseId),
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => null,
}));
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
      isPending: false,
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

  it('is undefined while the list loads and `Bot` once it has failed', () => {
    useBotsQuery.mockReturnValue({
      isPending: true,
      isSuccess: false,
      data: undefined,
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      expect(context.botName(() => TEAM_BOT)()).toBeUndefined();
      dispose();
    });

    useBotsQuery.mockReturnValue({
      isPending: false,
      isSuccess: false,
      isError: true,
      data: undefined,
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      expect(context.botName(() => TEAM_BOT)()).toBe('Bot');
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

describe('appActivityContext.entityDisplay', () => {
  beforeEach(() => {
    useDatabaseDetailQuery.mockReset();
    usePropertyEntityDisplay.mockClear();
  });

  it('names a database from its detail query and opens it as a database block', () => {
    useDatabaseDetailQuery.mockReturnValue({
      isPending: false,
      isSuccess: true,
      data: { database: { name: 'Roadmap' } },
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      const display = context.entityDisplay(
        () => 'database-1',
        () => 'DATABASE'
      );

      expect(display.name()).toBe('Roadmap');
      expect(display.isLoading()).toBe(false);
      expect(display.blockOrFileType()).toBe('database');
      expect(display.linkParams()).toBeUndefined();
      expect(usePropertyEntityDisplay).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('reads `Loading...` while the database loads and `Database` once it has failed', () => {
    useDatabaseDetailQuery.mockReturnValue({
      isPending: true,
      isSuccess: false,
      data: undefined,
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      const display = context.entityDisplay(
        () => 'database-1',
        () => 'DATABASE'
      );
      expect(display.name()).toBe('Loading...');
      expect(display.isLoading()).toBe(true);
      dispose();
    });

    useDatabaseDetailQuery.mockReturnValue({
      isPending: false,
      isSuccess: false,
      isError: true,
      data: undefined,
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      const display = context.entityDisplay(
        () => 'database-1',
        () => 'DATABASE'
      );
      expect(display.name()).toBe('Database');
      expect(display.isLoading()).toBe(false);
      dispose();
    });
  });

  it('resolves every other entity kind through the property display', () => {
    createRoot((dispose) => {
      const context = useActivityContext();
      context.entityDisplay(
        () => 'doc-1',
        () => 'DOCUMENT'
      );
      expect(usePropertyEntityDisplay).toHaveBeenCalledTimes(1);
      expect(useDatabaseDetailQuery).not.toHaveBeenCalled();
      dispose();
    });
  });
});
