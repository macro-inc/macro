import { resetQueryAccountSession } from '@app/lib/queries/auth/account-scope';
import { authKeys } from '@app/lib/queries/auth/keys';
import type { CrmTeamSettingsResponse } from '@service-storage/generated/schemas/crmTeamSettingsResponse';
import type { UpdateCrmTeamSettingsRequest } from '@service-storage/generated/schemas/updateCrmTeamSettingsRequest';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamCrmSavedView } from '../core/team-config';
import type { CrmQueryDependencies } from './dependencies';
import { CRM_TEAM_SETTINGS_QUERY_KEY, useTeamCrmConfig } from './team-config';

const [viewer, setViewer] = createSignal('account-one');
let client: QueryClient;

vi.mock('@app/lib/queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => viewer,
  useIsAuthenticated: () => () => true,
}));

vi.mock('@app/lib/urql-solid/authorization', () => ({
  captureQueryAuthorization: () => () => false,
}));

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  setViewer('account-one');
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const view = (id: string) => ({ id, name: id, config: {} });

it.each([false, true])(
  'uses a fresh baseline after a committed response skips admission (read fails: %s)',
  async (failNextRead) => {
    let saved: CrmTeamSettingsResponse = {
      edit_stages_role: 'admin',
      move_closed_deals_role: 'admin',
      delete_records_role: 'admin',
      team_views: [],
      default_team_view_id: null,
      legacy_stage_ids: {},
      exclude_personal_emails: false,
    };
    const storage = {
      getCrmTeamSettings: vi.fn(async () => ok(saved)),
      updateCrmTeamSettings: vi.fn(
        async (body: UpdateCrmTeamSettingsRequest) => {
          saved = { ...saved, team_views: body.team_views ?? saved.team_views };
          return ok(saved);
        }
      ),
    };
    let config!: ReturnType<typeof useTeamCrmConfig>;
    function Probe() {
      config = useTeamCrmConfig({
        storage,
        client,
      } as unknown as CrmQueryDependencies);
      return null;
    }
    const rendered = render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await vi.waitFor(() => expect(config.isLoading()).toBe(false));
    // Model an unsuccessful background refetch: the old query value remains.
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    await config.update.mutateAsync({
      teamViews: (current) => [...current, view('first')],
    });
    expect(config.config().teamViews).toEqual([]);
    if (failNextRead)
      storage.getCrmTeamSettings.mockRejectedValueOnce(new Error('offline'));
    const next = config.update.mutateAsync({
      teamViews: (current) => [...current, view('second')],
    });
    if (failNextRead) {
      await expect(next).rejects.toBeDefined();
      expect(storage.updateCrmTeamSettings).toHaveBeenCalledTimes(1);
    } else {
      await next;
      expect(storage.updateCrmTeamSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ team_views: [view('first'), view('second')] })
      );
    }
    rendered.unmount();
    client.clear();
  }
);

it.each(['account-two', 'account-one'])(
  'does not run a queued updater after a replacement login as %s',
  async (replacement) => {
    const settings: CrmTeamSettingsResponse = {
      edit_stages_role: 'admin',
      move_closed_deals_role: 'admin',
      delete_records_role: 'admin',
      team_views: [],
      default_team_view_id: null,
      legacy_stage_ids: {},
      exclude_personal_emails: false,
    };
    client.setQueryData(CRM_TEAM_SETTINGS_QUERY_KEY, settings);
    const started = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<Ok<CrmTeamSettingsResponse, never>>();
    const storage = {
      getCrmTeamSettings: vi.fn(async () => ok(settings)),
      updateCrmTeamSettings: vi.fn(() => {
        started.resolve();
        return response.promise;
      }),
    };
    let config!: ReturnType<typeof useTeamCrmConfig>;
    function Probe() {
      config = useTeamCrmConfig({
        storage,
        client,
      } as unknown as CrmQueryDependencies);
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    const first = config.update.mutateAsync({ teamViews: [view('first')] });
    await started.promise;
    const updater = vi.fn((current: TeamCrmSavedView[]) => [
      ...current,
      view('second'),
    ]);
    const queued = config.update.mutateAsync({ teamViews: updater });
    const rejected = expect(queued).rejects.toThrow('Query account changed');
    expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(
      true
    );

    await resetQueryAccountSession();
    setViewer(replacement);
    await client.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () => ({ id: replacement, authenticated: true }),
      staleTime: 0,
    });
    response.resolve(ok({ ...settings, team_views: [view('first')] }));
    await first;
    await rejected;
    expect(storage.getCrmTeamSettings).not.toHaveBeenCalled();
    expect(storage.updateCrmTeamSettings).toHaveBeenCalledOnce();
    expect(updater).not.toHaveBeenCalled();
    expect(client.getQueryData(CRM_TEAM_SETTINGS_QUERY_KEY)).toEqual(settings);
  }
);

it('does not invoke the updater or PUT if the account changes during its baseline GET', async () => {
  const settings: CrmTeamSettingsResponse = {
    edit_stages_role: 'admin',
    move_closed_deals_role: 'admin',
    delete_records_role: 'admin',
    team_views: [view('existing')],
    default_team_view_id: null,
    legacy_stage_ids: {},
    exclude_personal_emails: false,
  };
  client.setQueryData(CRM_TEAM_SETTINGS_QUERY_KEY, settings);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Ok<CrmTeamSettingsResponse, never>>();
  const storage = {
    getCrmTeamSettings: vi.fn(() => {
      started.resolve();
      return response.promise;
    }),
    updateCrmTeamSettings: vi.fn(async () => ok(settings)),
  };
  let config!: ReturnType<typeof useTeamCrmConfig>;
  function Probe() {
    config = useTeamCrmConfig({
      storage,
      client,
    } as unknown as CrmQueryDependencies);
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  const updater = vi.fn((current: TeamCrmSavedView[]) => [
    ...current,
    view('new'),
  ]);
  const pending = config.update.mutateAsync({ teamViews: updater });
  const rejected = expect(pending).rejects.toThrow('Query account changed');
  await started.promise;
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: 'account-two',
    authenticated: true,
  });
  setViewer('account-two');
  response.resolve(ok(settings));
  await rejected;
  expect(storage.getCrmTeamSettings).toHaveBeenCalledOnce();
  expect(storage.updateCrmTeamSettings).not.toHaveBeenCalled();
  expect(updater).not.toHaveBeenCalled();
});
