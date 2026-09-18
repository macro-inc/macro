import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  type DatabaseViewConfig,
  isSavedDatabaseViewConfig,
  type SavedDatabaseView,
  type SavedDatabaseViewConfig,
} from '../core/database-view';
import { databaseViewKeys } from './keys';

/** Personal views use the existing saved-views API; no database data is copied. */
export function useSavedDatabaseViews(
  databaseId: Accessor<string>,
  tableId: Accessor<string | undefined>
) {
  const queryClient = useQueryClient();
  const query = useQuery(() => ({
    queryKey: databaseViewKeys.saved.queryKey,
    queryFn: () => throwOnErr(() => storageServiceClient.views.getSavedViews()),
    enabled: !!databaseId() && !!tableId(),
    staleTime: 30_000,
  }));
  // Resource reads are guarded: loading views must not suspend the table.
  const views = (): SavedDatabaseView[] =>
    query.isSuccess
      ? query.data.views.flatMap((entry) => {
          const config = entry.config;
          return isSavedDatabaseViewConfig(config) &&
            config.databaseId === databaseId() &&
            config.tableId === tableId()
            ? [{ id: entry.id, name: entry.name, view: config.view }]
            : [];
        })
      : [];
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: databaseViewKeys.saved.queryKey,
    });
  };
  const save = useMutation(() => ({
    mutationFn: async (input: {
      id?: string;
      name: string;
      view: DatabaseViewConfig;
    }) => {
      const table = tableId();
      if (!table) throw new Error('Select a table before saving a view');
      const name = input.name.trim();
      if (!name) throw new Error('Give your view a name');
      if (input.id && !views().some((view) => view.id === input.id))
        throw new Error('This saved view is no longer available');
      const config: SavedDatabaseViewConfig = {
        kind: 'database-view',
        version: 1,
        databaseId: databaseId(),
        tableId: table,
        view: input.view,
      };
      if (input.id) {
        await throwOnErr(() =>
          storageServiceClient.views.patchView({
            saved_view_id: input.id!,
            name,
            config,
          })
        );
        return input.id;
      }
      const created = await throwOnErr(() =>
        storageServiceClient.views.createSavedView({ name, config })
      );
      return created.id;
    },
    onSuccess: invalidate,
  }));
  const rename = useMutation(() => ({
    mutationFn: async (input: { id: string; name: string }) => {
      const name = input.name.trim();
      if (!name) throw new Error('Give your view a name');
      if (!views().some((view) => view.id === input.id))
        throw new Error('This saved view is no longer available');
      await throwOnErr(() =>
        storageServiceClient.views.patchView({
          saved_view_id: input.id,
          name,
        })
      );
    },
    onSuccess: invalidate,
  }));
  const remove = useMutation(() => ({
    mutationFn: async (id: string) => {
      if (!views().some((view) => view.id === id))
        throw new Error('This saved view is no longer available');
      await throwOnErr(() =>
        storageServiceClient.views.deleteView({ savedViewId: id })
      );
    },
    onSuccess: invalidate,
  }));
  return { views, query, save, rename, remove };
}
