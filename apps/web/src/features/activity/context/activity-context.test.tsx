import { MACRO_SYSTEM_BOT_ID } from '@core/constant/macroSystem';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const [databasesEnabled, setDatabasesEnabled] = createSignal(true);
const useBotsQuery = vi.fn();
const useDatabasesQuery = vi.fn();
const usePropertyEntityDisplay = vi.fn(
  (_entityId: () => string, _entityType: () => string) => ({})
);

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: databasesEnabled() }),
}));
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
  useDatabasesQuery: () => useDatabasesQuery(),
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

describe('appActivityContext.entityTypeShown', () => {
  it('shows database rows only while databases are on', () => {
    createRoot((dispose) => {
      const context = useActivityContext();
      setDatabasesEnabled(false);
      expect(context.entityTypeShown('database')).toBe(false);
      expect(context.entityTypeShown('document')).toBe(true);
      setDatabasesEnabled(true);
      expect(context.entityTypeShown('database')).toBe(true);
      dispose();
    });
  });
});

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
    useDatabasesQuery.mockReset();
    usePropertyEntityDisplay.mockClear();
  });

  it('names databases from one list subscription and opens them as database blocks', () => {
    useDatabasesQuery.mockReturnValue({
      isPending: false,
      isSuccess: true,
      data: [
        {
          database: {
            id: 'database-1',
            name: 'Roadmap',
            owner_id: 'owner',
            created_at: '2026-10-01T00:00:00Z',
            trashed_at: null,
          },
          grant: 'owner',
          tables: [],
        },
        {
          database: {
            id: 'database-2',
            name: 'Hiring',
            owner_id: 'owner',
            created_at: '2026-10-01T00:00:00Z',
            trashed_at: null,
          },
          grant: 'edit',
          tables: [],
        },
      ],
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      const roadmap = context.entityDisplay(
        () => 'database-1',
        () => 'DATABASE'
      );
      const hiring = context.entityDisplay(
        () => 'database-2',
        () => 'DATABASE'
      );

      expect(roadmap.name()).toBe('Roadmap');
      expect(hiring.name()).toBe('Hiring');
      expect(roadmap.isLoading()).toBe(false);
      expect(roadmap.blockOrFileType()).toBe('database');
      expect(roadmap.linkParams()).toBeUndefined();
      expect(useDatabasesQuery).toHaveBeenCalledTimes(1);
      expect(usePropertyEntityDisplay).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('reads `Loading...` while the list loads and `Database unavailable` once it has failed', () => {
    useDatabasesQuery.mockReturnValue({
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

    useDatabasesQuery.mockReturnValue({
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
      expect(display.name()).toBe('Database unavailable');
      expect(display.isLoading()).toBe(false);
      dispose();
    });
  });

  it('reads `Database unavailable` for a database the viewer cannot list', () => {
    useDatabasesQuery.mockReturnValue({
      isPending: false,
      isSuccess: true,
      data: [],
    });
    createRoot((dispose) => {
      const context = useActivityContext();
      const display = context.entityDisplay(
        () => 'database-1',
        () => 'DATABASE'
      );
      expect(display.name()).toBe('Database unavailable');
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
      expect(useDatabasesQuery).not.toHaveBeenCalled();
      dispose();
    });
  });
});
