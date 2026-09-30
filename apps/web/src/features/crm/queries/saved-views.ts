import type { CrmQueryDependencies } from './dependencies';
/**
 * CRM saved views: named snapshots of the Customers view state.
 *
 * - Personal views persist per-user through the existing `/saved_views`
 *   API (arbitrary JSON config, frontend-owned shape).
 * - Team views live in the shared team CRM config (see team-crm-config)
 *   so every team member sees them.
 * - Any view can be shared as a link: the config is base64url-encoded in
 *   the `crmView` search param of the Customers URL, so anyone on the
 *   team can open it (the link carries only view state, never data).
 */

import { throwOnErr } from '@core/util/result';
import type { View } from '@service-storage/generated/schemas/view';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import type { TeamConfigSource } from '../context/crm-sources';
import { type CrmViewConfig, isCrmViewConfig } from '../core/saved-view';
import type { TeamCrmSavedView } from '../core/team-config';

export { type CrmViewConfig, isCrmViewConfig } from '../core/saved-view';
export {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
  encodeCrmViewParam,
} from './saved-view-codec';

const CRM_SAVED_VIEWS_QUERY_KEY = ['crm', 'saved-views'] as const;

export type PersonalCrmView = View & { config: CrmViewConfig };

/** Personal saved views (server-persisted via /saved_views). */
export function usePersonalCrmViews(deps: CrmQueryDependencies) {
  const queryClient = deps.client;

  const viewsQuery = useQuery(
    () => ({
      queryKey: CRM_SAVED_VIEWS_QUERY_KEY,
      queryFn: async () =>
        await throwOnErr(async () => await deps.storage.views.getSavedViews()),
    }),
    () => deps.client
  );

  const views = createMemo((): PersonalCrmView[] =>
    (viewsQuery.isSuccess ? viewsQuery.data.views : []).filter(
      (view): view is PersonalCrmView => isCrmViewConfig(view.config)
    )
  );

  const defaultView = () => views().find((view) => view.config.isDefault);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: CRM_SAVED_VIEWS_QUERY_KEY });

  const createMutation = useMutation(
    () => ({
      mutationFn: async (vars: { name: string; config: CrmViewConfig }) =>
        await throwOnErr(
          async () =>
            await deps.storage.views.createSavedView({
              name: vars.name,
              config: vars.config,
            })
        ),
      onSuccess: () => invalidate(),
      onError: (error: Error) => {
        console.error('Failed to save view', error);
        deps.feedback.failure('Failed to save view');
      },
    }),
    () => deps.client
  );

  const renameMutation = useMutation(
    () => ({
      mutationFn: async (vars: { id: string; name: string }) =>
        await throwOnErr(
          async () =>
            await deps.storage.views.patchView({
              saved_view_id: vars.id,
              name: vars.name,
            })
        ),
      onSuccess: () => invalidate(),
      onError: (error: Error) => {
        console.error('Failed to rename view', error);
        deps.feedback.failure('Failed to rename view');
      },
    }),
    () => deps.client
  );

  const deleteMutation = useMutation(
    () => ({
      mutationFn: async (vars: { id: string }) =>
        await throwOnErr(
          async () =>
            await deps.storage.views.deleteView({ savedViewId: vars.id })
        ),
      onSuccess: () => invalidate(),
      onError: (error: Error) => {
        console.error('Failed to delete view', error);
        deps.feedback.failure('Failed to delete view');
      },
    }),
    () => deps.client
  );

  // The backend PATCH shallow-merges into the stored config, so sending just
  // `{isDefault}` flips the flag without touching the rest of the snapshot.
  const setDefaultMutation = useMutation(
    () => ({
      mutationFn: async (vars: { id: string | undefined }) => {
        const { id } = vars;
        const previous = defaultView();
        if (previous && previous.id !== id) {
          await throwOnErr(
            async () =>
              await deps.storage.views.patchView({
                saved_view_id: previous.id,
                config: { isDefault: false },
              })
          );
        }
        if (id !== undefined) {
          await throwOnErr(
            async () =>
              await deps.storage.views.patchView({
                saved_view_id: id,
                config: { isDefault: true },
              })
          );
        }
      },
      onSuccess: () => invalidate(),
      onError: (error: Error) => {
        console.error('Failed to set default view', error);
        deps.feedback.failure('Failed to set default view');
      },
    }),
    () => deps.client
  );

  return {
    views,
    defaultView,
    isLoading: () => viewsQuery.isLoading,
    create: createMutation,
    rename: renameMutation,
    remove: deleteMutation,
    setDefault: setDefaultMutation,
  };
}

/** Team-shared saved views (stored in the shared team CRM config). */
export function useTeamCrmViews(
  deps: CrmQueryDependencies,
  userId: Accessor<string | undefined>,
  settings: TeamConfigSource
) {
  const { config, update, isLoading } = settings;

  const views = createMemo((): TeamCrmSavedView[] =>
    (config().teamViews ?? []).filter((view) => isCrmViewConfig(view.config))
  );

  const defaultViewId = () => config().defaultTeamViewId;

  const defaultView = () => views().find((view) => view.id === defaultViewId());

  const setDefault = (id: string | undefined) => {
    update.mutate(
      { defaultTeamViewId: id ?? null },
      {
        onError: (error: Error) => {
          console.error('Failed to set default team view', error);
          deps.feedback.failure('Failed to set default team view');
        },
      }
    );
  };

  const add = (name: string, viewConfig: CrmViewConfig) => {
    const view: TeamCrmSavedView = {
      id: crypto.randomUUID(),
      name,
      config: viewConfig,
      createdBy: userId(),
      createdAt: new Date().toISOString(),
    };
    update.mutate(
      // Updater form: derives from the latest cache when the (serialized)
      // mutation actually runs, so rapid saves don't drop each other.
      { teamViews: (current) => [...current, view] },
      {
        onError: (error: Error) => {
          console.error('Failed to save team view', error);
          deps.feedback.failure('Failed to save team view');
        },
      }
    );
  };

  const remove = (id: string) => {
    update.mutate(
      {
        teamViews: (current) => current.filter((view) => view.id !== id),
        // A deleted view can't stay the team default.
        ...(config().defaultTeamViewId === id
          ? { defaultTeamViewId: null }
          : {}),
      },
      {
        onError: (error: Error) => {
          console.error('Failed to delete team view', error);
          deps.feedback.failure('Failed to delete team view');
        },
      }
    );
  };

  return {
    views,
    defaultViewId,
    defaultView,
    add,
    remove,
    setDefault,
    isLoading,
    isSaving: () => update.isPending,
  };
}
