import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { teamInviteLinkUrl } from '@app/features/settings/TeamInviteLinkSection';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { deriveIsAuthenticated } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import { Telemetry } from '@macro-inc/observability';
import {
  useAiBillingPlansQuery,
  useCreateBillingPortalMutation,
  useCreateCheckoutSessionMutation,
  useGithubLinkStatusQuery,
  useTrialEligibilityQuery,
} from '@queries/auth';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { type UserInfoData, useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
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
  fetchTeamInviteLinkToken,
  useCreateTeamInviteLinkMutation,
} from '@queries/team/invite-link';
import { useSendReferralInvitesMutation } from '@queries/team/referrals';
import {
  useCreateTeamWithInvitesMutation,
  userTeamsQueryOptions,
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

/** Copies `text`, confirming either way; rejects when nothing was copied. */
async function copyLink(text: string, copied: string, failed: string) {
  if (await writeClipboardData({ 'text/plain': text })) {
    toast.success(copied);
    return;
  }
  toast.failure(failed);
  throw new Error(failed);
}

async function linkUrl(token: Promise<string>) {
  return teamInviteLinkUrl(await token);
}

async function textBlob(text: Promise<string>) {
  return new Blob([await text], { type: 'text/plain' });
}

/**
 * Copies text that is still loading. The clipboard write starts before the
 * text resolves so it keeps the click's user activation.
 */
async function copyPendingText(text: Promise<string>): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (!clipboard) return false;
  if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
    const write = clipboard.write([
      new ClipboardItem({ 'text/plain': textBlob(text) }),
    ]);
    try {
      await write;
      return true;
    } catch {
      // Fall through to writeText once the text is known.
    }
  }
  try {
    return await writeClipboardData({ 'text/plain': await text });
  } catch {
    return false;
  }
}

/** The created team's id, or undefined when creation failed. */
async function createdTeamId(creation: Promise<{ id: string }>) {
  try {
    return (await creation).id;
  } catch {
    return undefined;
  }
}

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
  const billingPortal = useCreateBillingPortalMutation();
  const completeOnboarding = useCompleteOnboardingMutation();
  const completeTutorial = useCompleteTutorialMutation();
  const connectTool = createOnboardingToolConnect();
  const createInviteLink = useCreateTeamInviteLinkMutation();
  const sendReferrals = useSendReferralInvitesMutation();
  // A team created on this step: its optimistic placeholder is in the teams
  // cache until creation settles, so the invite link waits for the real id.
  let createdTeam: Promise<string | undefined> | undefined;

  const currentTeamId = async () =>
    (await createdTeam) ??
    (await queryClient.fetchQuery(userTeamsQueryOptions()))[0]?.id;

  /** The team's link token, creating the link when the team has none. Only
   * admins and owners may create one; the mutation reports that failure. */
  const teamInviteLinkToken = () =>
    Telemetry.span('onboarding.team_invite_link', async (span) => {
      const teamId = await currentTeamId();
      if (!teamId) throw new Error('Not on a team');
      span.setAttr('team.id', teamId);
      const existing = await fetchTeamInviteLinkToken(teamId);
      span.setAttr('invite_link.created', existing === null);
      return existing ?? (await createInviteLink.mutateAsync({ teamId }));
    });

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
          if (connected.isError)
            fireAndForget(connected.refetch(), 'onboarding');
          if (native.isError) fireAndForget(native.refetch(), 'onboarding');
          if (github.isError) fireAndForget(github.refetch(), 'onboarding');
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
          fireAndForget(teams.refetch(), 'onboarding');
          fireAndForget(invites.refetch(), 'onboarding');
        },
      };
    },
    createTeam: async ({ name, invites, allowDomainJoin }) => {
      const creation = createTeam.mutateAsync({
        name,
        invites: invites.map((email) => ({ email })),
        allowDomainJoin,
      });
      createdTeam = createdTeamId(creation);
      await creation;
    },
    joinTeam: async (inviteId) => {
      await joinTeam.mutateAsync({ teamInviteId: inviteId });
    },
    copyTeamInviteLink: async () => {
      const url = linkUrl(teamInviteLinkToken());
      // Start the write inside the click; Safari drops it after an await.
      const copied = copyPendingText(url);
      try {
        await url;
      } catch (error) {
        if (!createInviteLink.isError)
          toast.failure("Couldn't get your team's invite link");
        throw error;
      }
      if (await copied) {
        toast.success('Invite link copied');
        return;
      }
      toast.failure('Could not copy invite link');
      throw new Error('Could not copy invite link');
    },
    sendReferralInvites: async (emails) => {
      const { sent } = await sendReferrals.mutateAsync(emails);
      if (sent.length === 0) throw new Error('No referral invites were sent');
    },
    copyReferralLink: async () => {
      const code = queryReadyGate(userInfo)
        ? userInfo.data.referralCode
        : undefined;
      if (!code) {
        toast.failure("Your referral link isn't ready yet");
        throw new Error('No referral code');
      }
      await copyLink(
        `${getWebOrigin()}/app/signup?referral_code=${code}`,
        'Referral link copied',
        'Failed to copy link'
      );
    },

    createInviteOffer: () => {
      const query = useGtmInviteOfferQuery({ enabled: needsOnboarding });
      return () => loadableQuery(query, (offer) => offer ?? null);
    },
    createTrialEligibility: () => {
      const query = useTrialEligibilityQuery({ enabled: needsOnboarding });
      return {
        eligibility: () =>
          loadableQuery(query, (data) => data.eligible, {
            retainDataOnError: false,
          }),
        existingSubscription: () =>
          queryReadyGate(query) && query.data.existingSubscription,
        managing: () => billingPortal.isPending,
        manage: async () => {
          try {
            const result = await billingPortal.mutateAsync({
              returnUrl: window.location.href,
            });
            window.location.href = result;
          } catch {
            toast.failure(
              "Couldn't open billing management. Please try again."
            );
          }
        },
        retry: () => {
          fireAndForget(query.refetch(), 'onboarding');
        },
      };
    },
    createPlanCatalog: () => {
      const query = useAiBillingPlansQuery();
      return {
        catalog: () => loadableQuery(query, (data) => data),
        retry: () => {
          fireAndForget(query.refetch(), 'onboarding');
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
