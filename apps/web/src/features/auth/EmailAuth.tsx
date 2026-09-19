import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { updateUserAuth } from '@core/auth';
import { redirectToEmailAuth } from '@core/auth/email';
import { publishLoginSuccess } from '@core/auth/login-events';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { restoreSettingsReturnTo } from '@core/constant/SettingsState';
import { appendSettingsSplitToUrl } from '@core/constant/settingsSplitUrl';
import { settingsTabToSlug } from '@core/constant/settingsTabsConfig';
import { useEmailLinks } from '@core/email-link';
import { consumeInboxLinkReturn } from '@core/email-link/return-layout';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { whenSettled } from '@core/util/whenSettled';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { createSignal, onMount, Show, Suspense } from 'solid-js';

type EmailAuthParams = {
  callbackPath: string;
  successPath: string;
  linkCallbackPath: string;
};

export function makeEmailAuthComponents(params: EmailAuthParams) {
  return {
    EmailCallback: () => (
      <Suspense>
        <EmailSignupCallback successPath={params.successPath} />
      </Suspense>
    ),
    EmailSignUp: () => (
      <Suspense>
        <EmailSignUp
          callbackPath={params.callbackPath}
          successPath={params.successPath}
        />
      </Suspense>
    ),
    EmailLinkCallback: () => (
      <Suspense>
        <EmailLinkCallback successPath={params.successPath} />
      </Suspense>
    ),
    CALLBACK_PATH: params.callbackPath,
    LINK_CALLBACK_PATH: params.linkCallbackPath,
  };
}

/**
 * Handles the OAuth callback after a user signs up.
 *
 * Always navigates to the success path,
 * showing a toast on failure to prevent users from getting stuck if email link init fails.
 */
function EmailSignupCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const { query, initEmailLink } = useEmailLinks();

  const onSuccessfulAuth = async () => {
    await updateUserAuth();
    await invalidateAllAfterLogin();
    publishLoginSuccess();
  };

  const navigateToSuccess = () => {
    navigate(props.successPath, { replace: true });
  };

  whenSettled(
    query,
    async () => {
      const onSuccess = () => {
        onSuccessfulAuth();
        navigateToSuccess();
      };

      await initEmailLink().match(onSuccess, (err) => {
        if (err.tag === 'AlreadyInitialized') {
          onSuccess();
          return;
        }
        toast.alert('Failed to connect email', {
          subtext: 'Select email permissions on sign-in to enable',
        });
        navigateToSuccess();
      });
    },
    (error) => {
      toast.failure(error.message);
      navigateToSuccess();
    }
  );

  return <LoadingBlock />;
}

/**
 * Where the callback lands when there is no layout to restore: the app's home
 * view with the Connections settings page docked beside it, so a user who just
 * granted access still sees the result. Only reachable when the stash is
 * missing — storage blocked, or a callback URL opened outside its own flow.
 */
const POST_LINK_FALLBACK_ROUTE = appendSettingsSplitToUrl(
  DEFAULT_ROUTE,
  settingsTabToSlug('Connected')
);

/**
 * Handles the OAuth callback after an already-authenticated user adds another Gmail
 * inbox via /link/gmail. Reads `link_id` from the query string and invokes init to
 * provision the second `email_links` row. Falls back to a toast on failure.
 *
 * Consent runs as a full page navigation, so the split layout — which lives in
 * the URL — is gone by the time this mounts. The add-inbox flow stashed it
 * against this `link_id`; restoring it is what keeps enabling calendar (or
 * adding an inbox) from clobbering whatever the user had open.
 */
function EmailLinkCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { query, initEmailLink } = useEmailLinks();
  const [conflict, setConflict] = createSignal<{
    linkId: string;
    emailAddress: string;
    ownerEmail: string;
  } | null>(null);

  const navigateToSuccess = () => {
    navigate(props.successPath, { replace: true });
  };

  const userInfoQuery = useUserInfoQuery();
  const onboardingV4 = useOnboardingV4Flag();

  // Return to the layout the flow left from, if this callback belongs to a
  // flow that stashed one. Consent replaced the page, so nothing in memory
  // survived — the stash is the only record of what the user had open.
  // Reports true when it navigated, so callers can fall through otherwise.
  const restoreLayoutBeforeConsent = (linkId: string) => {
    const stored = consumeInboxLinkReturn(linkId);
    if (!stored) return false;
    if (stored.settingsReturnTo) {
      restoreSettingsReturnTo(stored.settingsReturnTo);
    }
    navigate(stored.url, { replace: true });
    return true;
  };

  // Where the callback hands the user off, in order of preference: back into
  // onboarding for a first-run user, then the layout they left, then a
  // form-factor default — the list view on mobile, where the desktop settings
  // split doesn't exist and the toast is the confirmation.
  const navigateAfterLink = (linkId: string) => {
    // A first-run user connected this inbox from the onboarding flow:
    // return straight to it. Landing in mail settings would mount the app
    // shell mid-onboarding just for NewOnboardingRedirect to bounce back.
    if (
      onboardingV4().enabled &&
      !isMobile() &&
      !isNativeMobilePlatform() &&
      userInfoQuery.data?.tutorialComplete === false
    ) {
      navigate('/onboarding', { replace: true });
      return;
    }
    if (restoreLayoutBeforeConsent(linkId)) return;
    if (isMobile()) {
      navigateToSuccess();
      return;
    }
    navigate(POST_LINK_FALLBACK_ROUTE, { replace: true });
  };

  const runInit = async (linkId: string, forceShare: boolean) => {
    await initEmailLink({ linkId, forceShare }).match(
      async () => {
        // Pull the newly-provisioned link into the cache before leaving the
        // callback so the inbox panel shows it immediately on return rather
        // than flashing a stale list until its own refetch lands.
        await query.refetch();
        toast.success('Account connected');
        navigateAfterLink(linkId);
      },
      async (err) => {
        if (err.tag === 'AlreadyInitialized') {
          await query.refetch();
          navigateAfterLink(linkId);
          return;
        }
        // The mailbox is already connected by someone else. Hold the callback open
        // and let the user confirm sharing it before retrying with forceShare.
        if (err.tag === 'SharedInboxConflict' && !forceShare) {
          setConflict({
            linkId,
            emailAddress: err.emailAddress,
            ownerEmail: err.ownerEmail,
          });
          return;
        }
        if (err.tag === 'NoGmailGrant') {
          toast.failure(
            'Gmail access was not granted. Please allow all requested permissions and try again.'
          );
          navigateAfterLink(linkId);
          return;
        }
        toast.failure('Failed to add inbox');
        navigateAfterLink(linkId);
      }
    );
  };

  whenSettled(
    query,
    async () => {
      const linkId =
        typeof searchParams.link_id === 'string' ? searchParams.link_id : null;
      if (!linkId) {
        toast.failure('Missing link id in callback URL');
        navigateToSuccess();
        return;
      }

      await runInit(linkId, false);
    },
    (error) => {
      toast.failure(error.message);
      navigateToSuccess();
    }
  );

  return (
    <Show when={conflict()} fallback={<LoadingBlock />}>
      {(c) => (
        <ShareInboxConflictDialog
          open
          emailAddress={c().emailAddress}
          ownerEmail={c().ownerEmail}
          onCancel={() => {
            const linkId = c().linkId;
            setConflict(null);
            if (!restoreLayoutBeforeConsent(linkId)) navigateToSuccess();
          }}
          onShare={() => {
            const linkId = c().linkId;
            setConflict(null);
            void runInit(linkId, true);
          }}
        />
      )}
    </Show>
  );
}

function EmailSignUp(
  props: Pick<EmailAuthParams, 'callbackPath' | 'successPath'>
) {
  const navigate = useNavigate();
  const { query: emailLinks } = useEmailLinks();
  const analytics = useAnalytics();

  onMount(() => {
    analytics.pageView('signup');
  });

  const withAppPrefix = (path: string) => `/app${path}`;

  onMount(() => {
    if (emailLinks.data && emailLinks.data.links.length > 0) {
      navigate(props.successPath);
      return;
    }
    redirectToEmailAuth({
      returnPath: withAppPrefix(props.callbackPath),
    });
  });
  return <LoadingBlock />;
}
