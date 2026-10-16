import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { deriveIsAuthenticated } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { idToDisplayName, idToEmail } from '@core/user/util';
import {
  useAiBillingPlansQuery,
  useCreateCheckoutSessionMutation,
  useGithubLinkStatusQuery,
} from '@queries/auth';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { type UserInfoData, useUserInfoQuery } from '@queries/auth/user-info';
import { useContactsQuery } from '@queries/contacts/contacts';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { useGithubStarsQuery } from '@queries/github-stars';
import { useGtmInviteOfferQuery } from '@queries/gtm-invite/links';
import { useMcpServersQuery } from '@queries/mcp-servers';
import {
  useCompleteOnboardingMutation,
  useOnboardingQuery,
} from '@queries/onboarding';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
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
  OnboardingContext,
  ViewerState,
} from './context/onboarding-context';
import { onboardingCheckoutRequest } from './core/checkout';
import {
  onboardingConnectedTools,
  onboardingToolState,
} from './queries/connected-tools';
import { loadableQuery } from './queries/loadable-query';
import { createOnboardingToolCatalog } from './queries/tool-catalog';
import { createOnboardingToolConnect } from './queries/tool-connect';

/** How often connected tools re-check while the user is on the tools step. */
const CONNECTED_TOOLS_POLL_MS = 5_000;

type UserInfoResult = {
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  error: Error | null;
  data: UserInfoData | undefined;
};

function toViewerState(result: UserInfoResult): ViewerState {
  // Guarded: an unguarded `data` read suspends while the query is pending.
  const data = queryReadyGate(result) ? result.data : undefined;
  // A signed-out visitor's request 401s rather than answering unauthenticated.
  const authenticated = deriveIsAuthenticated({
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    data,
  });
  if (authenticated === false) return { t: 'signed-out' };
  if (!data?.userId) return { t: 'loading' };
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
  const connectTool = createOnboardingToolConnect();

  const viewer = () => toViewerState(userInfo);
  const needsOnboarding = () => {
    const state = viewer();
    return state.t === 'signed-in' && !state.viewer.tutorialComplete;
  };
  return {
    viewer,
    refreshViewer: async () => {
      return toViewerState(await userInfo.refetch());
    },

    createOnboardingRecord: () => {
      // Reading the record creates it and starts gathers, so only a viewer who
      // is actually onboarding may read it.
      const query = useOnboardingQuery({ enabled: needsOnboarding });
      return () =>
        query.isPlaceholderData
          ? { t: 'loading' }
          : loadableQuery(query, (data) => ({
              status: data.row.status === 'completed' ? 'completed' : 'active',
              suggestedTeamDomain: data.suggested_team_domain ?? undefined,
            }));
    },

    createEmailAccounts: () => {
      const query = useEmailLinksQuery();
      return {
        accounts: () =>
          loadableQuery(query, (data) =>
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

    createToolCatalog: createOnboardingToolCatalog,
    createConnectedTools: ({ poll }) => {
      const connected = usePipedreamConnectionsQuery({
        neverSuspend: true,
        refetchInterval: poll ? CONNECTED_TOOLS_POLL_MS : undefined,
      });
      const native = useMcpServersQuery({
        neverSuspend: true,
        refetchInterval: poll ? CONNECTED_TOOLS_POLL_MS : undefined,
      });
      const github = useGithubLinkStatusQuery({
        refetchInterval: poll ? CONNECTED_TOOLS_POLL_MS : undefined,
        refetchOnMount: 'always',
      });
      const pdState = () =>
        connected.isPlaceholderData
          ? { t: 'loading' as const }
          : loadableQuery(connected, (data) => data);
      const nativeState = () =>
        native.isPlaceholderData
          ? { t: 'loading' as const }
          : loadableQuery(native, (data) => data);
      return {
        connected: () =>
          onboardingConnectedTools(
            new Set(
              queryReadyGate(connected)
                ? connected.data.filter((c) => c.enabled).map((c) => c.app_slug)
                : []
            ),
            queryReadyGate(native) ? native.data : [],
            queryReadyGate(github) && github.data.status === 'linked'
          ),
        state: (slug) =>
          onboardingToolState(
            slug,
            pdState(),
            nativeState(),
            loadableQuery(github, (data) => data.status)
          ),
        retry: () => {
          if (connected.isError) void connected.refetch();
          if (native.isError) void native.refetch();
          if (github.isError) void github.refetch();
        },
      };
    },
    connectTool,
    configureGithubRepositories: () => {
      window.open(
        `${SERVER_HOSTS['document-storage-service']}/github/install-sync`,
        '_blank',
        'noopener,noreferrer'
      );
    },

    createTeamDirectory: () => {
      const teams = useUserTeamsQuery();
      const invites = useUserInvitesQuery();
      const contacts = useContactsQuery();
      return {
        teams: () =>
          loadableQuery(teams, (data) =>
            data.map((team) => ({ name: team.name }))
          ),
        invites: () =>
          loadableQuery(invites, (data) =>
            (data.invites ?? []).map((invite) => ({
              id: invite.id,
              invitedBy: idToDisplayName(invite.invited_by),
            }))
          ),
        contacts: () =>
          loadableQuery(contacts, (data) => data.contacts.map(idToEmail)),
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

    createInviteOffer: () => {
      const query = useGtmInviteOfferQuery({ enabled: needsOnboarding });
      return () => loadableQuery(query, (offer) => offer ?? null);
    },
    createPlanCatalog: () => {
      const query = useAiBillingPlansQuery();
      return {
        catalog: () => loadableQuery(query, (data) => data),
        retry: () => {
          void query.refetch();
        },
      };
    },
    startCheckout: (tier, terms) =>
      checkout.mutateAsync(
        onboardingCheckoutRequest(
          `${window.location.origin}${ROUTER_BASE_CONCAT}onboarding`,
          tier,
          terms
        )
      ),
    completeOnboarding: async ({ skipped }) => {
      // Finish the row before publishing tutorialComplete, which lets the
      // auth gate unmount onboarding. The tutorial mutation updates its cache
      // from the successful PATCH; a racing refetch isn't a completion check.
      await completeOnboarding.mutateAsync({ skipped });
      await completeTutorial.mutateAsync();
      return { t: 'completed' };
    },
    repairTutorial: async () => {
      await completeTutorial.mutateAsync();
    },

    applyAccent: applyWorkspaceAccent,
    createGithubStars: () => {
      const stars = useGithubStarsQuery();
      return () => (queryReadyGate(stars) ? stars.data : undefined);
    },
    track: (event, data) => analytics.track(event, data),
    notifyFailure: (message) => toast.failure(message),
  };
}
