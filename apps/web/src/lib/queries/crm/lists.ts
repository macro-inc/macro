import {
  type CrmListConfig,
  isCrmListConfig,
} from '@companies/core/crm-navigation';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { crmKeys } from './keys';

/** Personal collections use saved-view storage, with explicit membership and team scope. */
export function useCrmLists(teamId: Accessor<string | undefined>) {
  const client = useQueryClient();
  const query = useQuery(() => ({
    queryKey: crmKeys.lists.queryKey,
    queryFn: () => throwOnErr(() => storageServiceClient.views.getSavedViews()),
    enabled: !!teamId(),
  }));
  const lists = () =>
    query.isSuccess
      ? query.data.views.flatMap((view) =>
          isCrmListConfig(view.config) && view.config.teamId === teamId()
            ? [{ id: view.id, name: view.name, config: view.config }]
            : []
        )
      : [];
  const save = useMutation(() => ({
    mutationFn: async (input: {
      id?: string;
      name: string;
      companyIds: string[];
    }) => {
      const team = teamId();
      if (!team) throw new Error('Join a team to create a list');
      const config: CrmListConfig = {
        kind: 'crm-list',
        teamId: team,
        companyIds: [...new Set(input.companyIds)],
      };
      if (input.id) {
        await throwOnErr(() =>
          storageServiceClient.views.patchView({
            saved_view_id: input.id!,
            name: input.name,
            config,
          })
        );
        return input.id;
      }
      const created = await throwOnErr(() =>
        storageServiceClient.views.createSavedView({ name: input.name, config })
      );
      return created.id;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: crmKeys.lists.queryKey }),
  }));
  const remove = useMutation(() => ({
    mutationFn: (id: string) =>
      throwOnErr(() =>
        storageServiceClient.views.deleteView({ savedViewId: id })
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: crmKeys.lists.queryKey }),
  }));
  const setMembership = useMutation(() => ({
    mutationFn: async (input: {
      listId: string;
      companyId: string;
      included: boolean;
    }) => {
      const team = teamId();
      if (!team) throw new Error('A team is required');
      // Refresh before editing so another company's recently changed membership
      // isn't overwritten by an old detail-page snapshot.
      const latest = await throwOnErr(() =>
        storageServiceClient.views.getSavedViews()
      );
      const list = latest.views.find((entry) => entry.id === input.listId);
      if (!list || !isCrmListConfig(list.config) || list.config.teamId !== team)
        throw new Error('This list is no longer available');
      const config = list.config;
      const companyIds = new Set(config.companyIds);
      if (input.included) companyIds.add(input.companyId);
      else companyIds.delete(input.companyId);
      await throwOnErr(() =>
        storageServiceClient.views.patchView({
          saved_view_id: list.id,
          config: { ...config, companyIds: [...companyIds] },
        })
      );
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: crmKeys.lists.queryKey }),
  }));
  return { query, lists, save, remove, setMembership };
}
