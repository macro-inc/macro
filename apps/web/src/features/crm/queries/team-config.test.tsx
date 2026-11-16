import type { CrmTeamSettingsResponse } from '@service-storage/generated/schemas/crmTeamSettingsResponse';
import type { UpdateCrmTeamSettingsRequest } from '@service-storage/generated/schemas/updateCrmTeamSettingsRequest';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmQueryDependencies } from './dependencies';
import { useTeamCrmConfig } from './team-config';

vi.mock('@app/lib/urql-solid/authorization', () => ({
  captureQueryAuthorization: () => () => false,
}));

afterEach(cleanup);

const view = (id: string) => ({ id, name: id, config: {} });

it.each([false, true])(
  'uses a fresh baseline after a committed response skips admission (read fails: %s)',
  async (failNextRead) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
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
