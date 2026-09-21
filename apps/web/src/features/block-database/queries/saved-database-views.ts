import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { View } from '@service-storage/generated/schemas/view';
import type { ViewsResponse } from '@service-storage/generated/schemas/viewsResponse';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type {
  DatabaseViewConfig,
  SavedDatabaseView,
  SavedDatabaseViewConfig,
} from '../core/database-view';
import { databaseViewKeys } from './keys';
import { selectSavedDatabaseViews } from './saved-database-view-data';

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
    query.isPending
      ? []
      : selectSavedDatabaseViews(
          query.data?.views ?? [],
          databaseId(),
          tableId()
        );
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: databaseViewKeys.saved.queryKey,
    });
  };
  async function updateCachedViews(update: (views: View[]) => View[]) {
    await queryClient.cancelQueries({
      queryKey: databaseViewKeys.saved.queryKey,
    });
    queryClient.setQueryData<ViewsResponse>(
      databaseViewKeys.saved.queryKey,
      (current) => ({
        excludedDefaultViews: current?.excludedDefaultViews ?? [],
        views: update(current?.views ?? []),
      })
    );
  }
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
        await updateCachedViews((views) =>
          views.map((view) =>
            view.id === input.id ? { ...view, name, config } : view
          )
        );
        return input.id;
      }
      const created = await throwOnErr(() =>
        storageServiceClient.views.createSavedView({ name, config })
      );
      await updateCachedViews((views) => [
        ...views.filter((view) => view.id !== created.id),
        created,
      ]);
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
      await updateCachedViews((views) =>
        views.map((view) => (view.id === input.id ? { ...view, name } : view))
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
      await updateCachedViews((views) =>
        views.filter((view) => view.id !== id)
      );
    },
    onSuccess: invalidate,
  }));
  return { views, query, save, rename, remove };
}
