import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow } from '@core/email-link';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { useCreateCheckoutSessionMutation } from '@queries/auth';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { type UserInfoData, useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useContactsQuery } from '@queries/contacts/contacts';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import { useGithubStarsQuery } from '@queries/github-stars';
import {
  useCompleteOnboardingMutation,
  useOnboardingQuery,
} from '@queries/onboarding';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import {
  useJoinTeamMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import {
  useCreateTeamWithInvitesMutation,
  useUserTeamsQuery,
} from '@queries/team/teams';
import { applyWorkspaceAccent } from './apply-workspace-accent';
import type {
  Loadable,
  OnboardingContext,
  ViewerState,
} from './context/onboarding-context';
import { onboardingCheckoutRequest } from './core/checkout';

/** How often connected tools re-check while the user is on the tools step. */
const CONNECTED_TOOLS_POLL_MS = 5_000;

function toViewerState(data: UserInfoData | undefined): ViewerState {
  if (!data) return { t: 'loading' };
  if (!data.authenticated || !data.userId) return { t: 'signed-out' };
  return {
    t: 'signed-in',
    viewer: {
      id: data.userId,
      email: data.email ?? undefined,
      tutorialComplete: data.tutorialComplete === true,
      licensed:
        data.licenseStatus === 'active' || data.licenseStatus === 'trialing',
    },
  };
}

/** TanStack status → source availability; data already loaded wins over a background failure. */
function loadable<T, R>(
  query: { isSuccess: boolean; isError: boolean; data: T | undefined },
  map: (data: T) => R
): Loadable<R> {
  if (query.isSuccess && query.data !== undefined)
    return { t: 'ready', value: map(query.data) };
  if (query.isError) return { t: 'error' };
  return { t: 'loading' };
}

/** Real queries, mutations, and app services behind the onboarding contract. */
export function createAppOnboardingContext(): OnboardingContext {
  const analytics = useAnalytics();
  const userInfo = useUserInfoQuery();
  const startAddInbox = useAddInboxFlow();
  const createTeam = useCreateTeamWithInvitesMutation();
  const joinTeam = useJoinTeamMutation();
  const checkout = useCreateCheckoutSessionMutation();
  const completeOnboarding = useCompleteOnboardingMutation();
  const completeTutorial = useCompleteTutorialMutation();

  const viewer = () =>
    toViewerState(userInfo.isSuccess ? userInfo.data : undefined);
  const needsOnboarding = () => {
    const state = viewer();
    return state.t === 'signed-in' && !state.viewer.tutorialComplete;
  };
  const refetchViewer = () =>
    queryClient
      .refetchQueries({ queryKey: authKeys.userInfo.queryKey })
      .catch(() => {});

  return {
    viewer,
    refreshViewer: async () => {
      const result = await userInfo.refetch();
      return toViewerState(result.data);
    },

    createOnboardingRecord: () => {
      // Reading the record creates it and starts gathers, so only a viewer who
      // is actually onboarding may read it.
      const query = useOnboardingQuery({ enabled: needsOnboarding });
      return () =>
        query.isPlaceholderData
          ? { t: 'loading' }
          : loadable(query, (data) => ({
              status: data.row.status === 'completed' ? 'completed' : 'active',
              suggestedTeamDomain: data.suggested_team_domain ?? undefined,
            }));
    },

    createEmailAccounts: () => {
      const query = useEmailLinksQuery();
      return {
        accounts: () =>
          loadable(query, (data) =>
            data.links.map((link) => ({
              address: link.email_address,
              isPrimary: link.is_primary,
              ownerId: link.macro_id,
            }))
          ),
        refresh: async () => invalidateEmailLinks(),
      };
    },
    connectInbox: () => startAddInbox(),

    createToolCatalog: () => {
      const catalog = createPipedreamCatalogSearch(() => new Set<string>());
      return {
        search: catalog.searchInput,
        setSearch: catalog.onSearchInput,
        entries: () =>
          catalog.entries().map((entry) => ({
            slug: entry.app_slug,
            name: entry.display_name,
            iconUrl: entry.icon_url ?? null,
          })),
        fetching: () => catalog.query.isFetching,
        failed: () => catalog.query.isError,
        hasMore: () => catalog.query.hasNextPage,
        loadMore: () => void catalog.query.fetchNextPage(),
        retry: () => void catalog.query.refetch(),
      };
    },
    createConnectedTools: () => {
      const connected = usePipedreamConnectedSlugs({
        refetchInterval: CONNECTED_TOOLS_POLL_MS,
      });
      return () => (connected.ready() ? connected.slugs() : undefined);
    },
    connectTool: (tool) =>
      createPipedreamCatalogConnect({
        entry: () => ({ app_slug: tool.slug, display_name: tool.name }),
      }).connect(),

    createTeamDirectory: () => {
      const teams = useUserTeamsQuery();
      const invites = useUserInvitesQuery();
      const contacts = useContactsQuery();
      return {
        teams: () =>
          loadable(teams, (data) => data.map((team) => ({ name: team.name }))),
        invites: () =>
          loadable(invites, (data) =>
            (data.invites ?? []).map((invite) => ({
              id: invite.id,
              invitedBy: idToDisplayName(invite.invited_by),
            }))
          ),
        contacts: () =>
          loadable(contacts, (data) => data.contacts.map(idToEmail)),
        retry: () => {
          void teams.refetch();
          void invites.refetch();
        },
      };
    },
    createTeam: async ({ name, invites }) => {
      await createTeam.mutateAsync({
        name,
        invites: invites.map((email) => ({ email })),
      });
    },
    joinTeam: async (inviteId) => {
      await joinTeam.mutateAsync({ teamInviteId: inviteId });
    },

    startCheckout: (tier) =>
      checkout.mutateAsync(
        onboardingCheckoutRequest(
          `${window.location.origin}${ROUTER_BASE_CONCAT}onboarding`,
          tier
        )
      ),
    completeOnboarding: async () => {
      const [onboardingResult] = await Promise.allSettled([
        completeOnboarding.mutateAsync({ skipped: false }),
        completeTutorial.mutateAsync(),
      ]);
      // Exiting with the row still active would leave staged candidates
      // undiscarded and the flow resumable after the user thinks it's done.
      if (onboardingResult.status === 'rejected') return { t: 'failed' };
      // The Layout redirect keys off tutorialComplete, so leaving before the
      // cache reflects the PATCH would bounce straight back. Read the cache,
      // not the observer: its store flushes on a later task.
      await refetchViewer();
      const data = queryClient.getQueryData<UserInfoData>(
        authKeys.userInfo.queryKey
      );
      return data?.tutorialComplete === true
        ? { t: 'completed' }
        : { t: 'failed' };
    },
    repairTutorial: async () => {
      await completeTutorial.mutateAsync();
      await refetchViewer();
    },

    applyAccent: applyWorkspaceAccent,
    createGithubStars: () => {
      const stars = useGithubStarsQuery();
      return () => (stars.isSuccess ? stars.data : undefined);
    },
    track: (event, data) => analytics.track(event, data),
    notifyFailure: (message) => toast.failure(message),
  };
}
