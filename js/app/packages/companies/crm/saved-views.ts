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

import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { View } from '@service-storage/generated/schemas/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { type TeamCrmSavedView, useTeamCrmConfig } from './team-crm-config';

/** Snapshot of the Customers view state. Fields are all optional so old
 * links/views keep working as the shape evolves. */
export type CrmViewConfig = {
  kind: 'crm';
  /** Server query filters (soup `Query`). */
  filters?: unknown;
  /** Client predicate ids ({ and, or }). */
  clientFilters?: { and?: string[]; or?: string[] };
  searchText?: string;
  /** Group-by id (e.g. `property:<definition-id>`); null = no grouping. */
  groupBy?: string | null;
  /** Sort ids (soup sort state). */
  sort?: string[];
  viewMode?: 'list' | 'board';
  /** Stage option ids selected in the Stage filter (may include NO_STAGE). */
  stageFilter?: string[];
  /** Owner ids selected in the Owner filter. */
  ownerFilter?: string[];
  activeTab?: string;
};

export function isCrmViewConfig(value: unknown): value is CrmViewConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'crm'
  );
}

export const CRM_VIEW_URL_PARAM = 'crmView';

/** Base64url-encode a view config for the share link. */
export function encodeCrmViewParam(config: CrmViewConfig): string {
  const json = JSON.stringify(config);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCrmViewParam(param: string): CrmViewConfig | undefined {
  try {
    const base64 = param.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isCrmViewConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Share link for a view config: /companies?crmView=<encoded>. */
export function buildCrmViewShareUrl(config: CrmViewConfig): string {
  const url = new URL('/companies', window.location.origin);
  url.searchParams.set(CRM_VIEW_URL_PARAM, encodeCrmViewParam(config));
  return url.toString();
}

const CRM_SAVED_VIEWS_QUERY_KEY = ['crm', 'saved-views'] as const;

export type PersonalCrmView = View & { config: CrmViewConfig };

/** Personal saved views (server-persisted via /saved_views). */
export function usePersonalCrmViews() {
  const queryClient = useQueryClient();

  const viewsQuery = useQuery(() => ({
    queryKey: CRM_SAVED_VIEWS_QUERY_KEY,
    queryFn: async () =>
      await throwOnErr(
        async () => await storageServiceClient.views.getSavedViews()
      ),
  }));

  const views = createMemo((): PersonalCrmView[] =>
    (viewsQuery.data?.views ?? []).filter((view): view is PersonalCrmView =>
      isCrmViewConfig(view.config)
    )
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: CRM_SAVED_VIEWS_QUERY_KEY });

  const createMutation = useMutation(() => ({
    mutationFn: async (vars: { name: string; config: CrmViewConfig }) =>
      await throwOnErr(
        async () =>
          await storageServiceClient.views.createSavedView({
            name: vars.name,
            config: vars.config,
          })
      ),
    onSuccess: () => invalidate(),
    onError: (error: Error) => {
      console.error('Failed to save view', error);
      toast.failure('Failed to save view');
    },
  }));

  const renameMutation = useMutation(() => ({
    mutationFn: async (vars: { id: string; name: string }) =>
      await throwOnErr(
        async () =>
          await storageServiceClient.views.patchView({
            saved_view_id: vars.id,
            name: vars.name,
          })
      ),
    onSuccess: () => invalidate(),
    onError: (error: Error) => {
      console.error('Failed to rename view', error);
      toast.failure('Failed to rename view');
    },
  }));

  const deleteMutation = useMutation(() => ({
    mutationFn: async (vars: { id: string }) =>
      await throwOnErr(
        async () =>
          await storageServiceClient.views.deleteView({ savedViewId: vars.id })
      ),
    onSuccess: () => invalidate(),
    onError: (error: Error) => {
      console.error('Failed to delete view', error);
      toast.failure('Failed to delete view');
    },
  }));

  return {
    views,
    isLoading: () => viewsQuery.isLoading,
    create: createMutation,
    rename: renameMutation,
    remove: deleteMutation,
  };
}

/** Team-shared saved views (stored in the shared team CRM config). */
export function useTeamCrmViews() {
  const userId = useUserId();
  const { config, update, isLoading } = useTeamCrmConfig();

  const views = createMemo((): TeamCrmSavedView[] =>
    (config().teamViews ?? []).filter((view) => isCrmViewConfig(view.config))
  );

  const add = (name: string, viewConfig: CrmViewConfig) => {
    const view: TeamCrmSavedView = {
      id: crypto.randomUUID(),
      name,
      config: viewConfig,
      createdBy: userId(),
      createdAt: new Date().toISOString(),
    };
    update.mutate(
      (current) => ({
        ...current,
        teamViews: [...(current.teamViews ?? []), view],
      }),
      {
        onError: (error: Error) => {
          console.error('Failed to save team view', error);
          toast.failure('Failed to save team view');
        },
      }
    );
  };

  const remove = (id: string) => {
    update.mutate(
      (current) => ({
        ...current,
        teamViews: (current.teamViews ?? []).filter((view) => view.id !== id),
      }),
      {
        onError: (error: Error) => {
          console.error('Failed to delete team view', error);
          toast.failure('Failed to delete team view');
        },
      }
    );
  };

  return { views, add, remove, isLoading, isSaving: () => update.isPending };
}
