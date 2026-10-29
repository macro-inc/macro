import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { openAddInboxDialog } from '@app/features/inbox/AddInboxDialog';
import { AdminConsentRequiredDialog } from '@app/features/inbox/AdminConsentRequiredDialog';
import { ShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { onboardingPathWithStep } from '@app/features/onboarding/core/next-target';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { AppEvents } from '@app/lib/analytics/app-events';
import { updateUserAuth } from '@core/auth';
import { redirectToEmailAuth } from '@core/auth/email';
import { publishLoginSuccess } from '@core/auth/login-events';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { settingsTabToSlug } from '@core/constant/settingsTabsConfig';
import { useEmailLinks } from '@core/email-link';
import {
  consumeInboxLinkReturn,
  readInboxLinkReturn,
} from '@core/email-link/return-layout';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { whenSettled } from '@core/util/whenSettled';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Telemetry } from '@macro-inc/observability';
import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import {
  invalidateAllAfterLogin,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import type { ConsentScopes } from '@service-auth/client';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { Button } from '@ui';
import {
  createSignal,
  Match,
  onCleanup,
  onMount,
  Suspense,
  Switch,
} from 'solid-js';

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
        onSuccessfulAuth().catch((error) =>
          Telemetry.error(error, { surface: 'email-auth' })
        );
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
const POST_LINK_FALLBACK_ROUTE = `${DEFAULT_ROUTE}/~/settings/${settingsTabToSlug('Connected')}`;

/**
 * The `email_link_notice` the auth service sends an administrator back with
 * after they approve Macro for their Microsoft 365 tenant.
 */
const ADMIN_CONSENT_GRANTED_NOTICE = 'admin_consent_granted';

/**
 * The `email_link_error` values the auth service redirects back with when a
 * consent screen ends without a usable grant. Anything else is a generic
 * failure.
 */
const ADMIN_CONSENT_REQUIRED_ERROR = 'admin_consent_required';
const CONSENT_CANCELLED_ERROR = 'cancelled';
/** Google's consent came back without the email permissions; nothing was connected. */
const GMAIL_NOT_GRANTED_ERROR = 'gmail_not_granted';

const stringParam = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : null;

/**
 * Google's consent left the email permissions unchecked, so nothing was
 * connected and the partial grant was revoked. The prompt outlives the
 * callback page and stays until the person dismisses it or tries again with
 * the permissions the flow asked for.
 */
function promptForEmailAccess(scopes: ConsentScopes | undefined) {
  const toastId = toast.custom(
    {
      title: 'Email access required',
      content: () =>
        "Macro connects an account's email and calendar together, so keep the email permissions checked. The account was not connected.",
      actions: [
        {
          label: 'Try again',
          onClick: () => {
            toast.dismiss(toastId);
            openAddInboxDialog({ scopes });
          },
        },
      ],
    },
    {
      persistent: true,
      region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
    }
  );
}

/**
 * Handles the OAuth callback after an already-authenticated user adds another
 * inbox via /link/gmail or /link/outlook. Reads `link_id` from the query string
 * and invokes init to provision the second `email_links` row. Falls back to a
 * toast on failure.
 *
 * A consent screen that ended without a usable grant arrives with
 * `email_link_error` instead: a cancel goes straight back, a tenant that needs
 * admin approval gets the dialog with the approval link, a Google consent that
 * left out the email permissions gets a prompt that stays until dismissed and
 * retries the same request, and anything else gets a toast.
 * An administrator who approved the tenant arrives with `email_link_notice`.
 *
 * Web consent navigates the page; desktop returns from the system browser via
 * a deep link. Both replace the split layout URL. The add-inbox flow stashed it
 * against this `link_id`; restoring it is what keeps enabling calendar (or
 * adding an inbox) from clobbering whatever the user had open.
 */
function EmailLinkCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { query, initEmailLink } = useEmailLinks();
  const analytics = useAnalytics();
  const trackOutcome = (
    outcome: AppEvents['email_link_callback_result']['outcome']
  ) => analytics.track('email_link_callback_result', { outcome });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const [conflict, setConflict] = createSignal<{
    linkId: string;
    emailAddress: string;
    ownerEmail: string;
  } | null>(null);
  const [adminConsent, setAdminConsent] = createSignal<{
    linkId: string | null;
    url: string | undefined;
  } | null>(null);

  const navigateToSuccess = () => {
    navigate(props.successPath, { replace: true });
  };

  const userInfoQuery = useUserInfoQuery();

  // Return to the layout the flow left from, if this callback belongs to a
  // flow that stashed one. The callback replaced the layout URL, so the stash
  // records what the user had open before consent.
  // Reports true when it navigated, so callers can fall through otherwise.
  const restoreLayoutBeforeConsent = (linkId: string) => {
    const stored = consumeInboxLinkReturn(linkId);
    if (!stored) return false;
    navigate(stored.url, { replace: true });
    return true;
  };

  // Where the callback hands the user off, in order of preference: back into
  // onboarding for a first-run user, then the layout they left, then a
  // form-factor default — the list view on mobile, where the desktop settings
  // split doesn't exist and the toast is the confirmation.
  const navigateAfterLink = (linkId: string | null) => {
    if (disposed) return;
    // A first-run user connected this inbox from the onboarding flow:
    // return straight to it. Landing in mail settings would mount the app
    // shell mid-onboarding just for NewOnboardingRedirect to bounce back.
    if (
      !isMobile() &&
      !isNativeMobilePlatform() &&
      userInfoQuery.data?.tutorialComplete === false
    ) {
      navigate(onboardingPathWithStep(searchParams.step), { replace: true });
      return;
    }
    if (linkId && restoreLayoutBeforeConsent(linkId)) return;
    if (isMobile()) {
      navigateToSuccess();
      return;
    }
    navigate(POST_LINK_FALLBACK_ROUTE, { replace: true });
  };

  const runInit = async (linkId: string, forceShare: boolean) => {
    try {
      await initEmailLink({ linkId, forceShare }).match(
        async () => {
          trackOutcome('connected');
          // Pull the newly-provisioned link into the cache before leaving the
          // callback so the inbox panel shows it immediately on return rather
          // than flashing a stale list until its own refetch lands.
          await query.refetch();
          toast.success('Account connected');
          navigateAfterLink(linkId);
        },
        async (err) => {
          if (err.tag === 'AlreadyInitialized') {
            trackOutcome('already_initialized');
            await query.refetch();
            navigateAfterLink(linkId);
            return;
          }
          // The mailbox is already connected by someone else. Hold the callback open
          // and let the user confirm sharing it before retrying with forceShare.
          if (err.tag === 'SharedInboxConflict' && !forceShare) {
            trackOutcome('shared_inbox_conflict');
            setConflict({
              linkId,
              emailAddress: err.emailAddress,
              ownerEmail: err.ownerEmail,
            });
            return;
          }
          if (err.tag === 'PaymentRequired') {
            trackOutcome('payment_required');
            toast.failure(
              'A professional subscription is required to add another inbox.'
            );
            navigateAfterLink(linkId);
            return;
          }
          if (err.tag === 'NoGmailGrant') {
            trackOutcome('no_gmail_grant');
            toast.failure(
              'Gmail access was not granted. Please allow all requested permissions and try again.'
            );
            navigateAfterLink(linkId);
            return;
          }
          trackOutcome('failed');
          toast.failure('Failed to add inbox');
          navigateAfterLink(linkId);
        }
      );
    } catch {
      trackOutcome('exception');
      if (disposed) return;
      toast.failure(
        'Failed to finish connecting your account. Please try again from Settings.'
      );
      navigateAfterLink(linkId);
    }
  };

  // The consent screen ended without a grant. The pending link is already
  // released server-side; this only explains the outcome and hands off.
  const handleConsentFailure = (error: string, linkId: string | null) => {
    if (error === CONSENT_CANCELLED_ERROR) {
      navigateAfterLink(linkId);
      return;
    }
    if (error === GMAIL_NOT_GRANTED_ERROR) {
      trackOutcome('gmail_not_granted');
      // The retry asks for what this flow asked for: a calendar entry point
      // wants email and calendar together, not email alone.
      promptForEmailAccess(
        linkId ? readInboxLinkReturn(linkId)?.scopes : undefined
      );
      navigateAfterLink(linkId);
      return;
    }
    if (error !== ADMIN_CONSENT_REQUIRED_ERROR) {
      toast.failure('Failed to connect your account. Please try again.');
      navigateAfterLink(linkId);
      return;
    }
    setAdminConsent({ linkId, url: undefined });
    fireAndForget(loadAdminConsentUrl(), 'email-auth');
  };

  // The approval link is built server-side so the client never carries the
  // Microsoft client id. The dialog stays open while it loads; a failure
  // leaves the copy action disabled with an explanation.
  const loadAdminConsentUrl = async () => {
    const providers = await fetchEmailConnectionProviders();
    setAdminConsent((current) =>
      current
        ? { ...current, url: providers.outlook_admin_consent_url ?? undefined }
        : current
    );
  };

  // Completing consent does not depend on the old inbox list loading first.
  // A paused or slow query must not prevent the new grant from being applied.
  onMount(() => {
    const linkId = stringParam(searchParams.link_id);
    if (
      stringParam(searchParams.email_link_notice) ===
      ADMIN_CONSENT_GRANTED_NOTICE
    ) {
      toast.success('Approved. Try connecting again.');
      openAddInboxDialog();
      navigateAfterLink(linkId);
      return;
    }
    const linkError = stringParam(searchParams.email_link_error);
    if (linkError) {
      handleConsentFailure(linkError, linkId);
      return;
    }
    if (!linkId) {
      trackOutcome('missing_link_id');
      toast.failure('Missing link id in callback URL');
      navigateToSuccess();
      return;
    }

    fireAndForget(runInit(linkId, false), 'email-auth');
  });

  return (
    <Switch
      fallback={
        <div class="flex size-full items-center justify-center p-6">
          <div
            role="status"
            class="flex max-w-sm flex-col items-center gap-3 text-center"
          >
            <SpinnerIcon class="size-6 animate-spin motion-reduce:animate-none text-accent" />
            <h1 class="text-sm font-semibold text-ink">
              Finishing account connection…
            </h1>
            <p class="text-sm text-ink-muted">
              We’re applying your Google permissions. Calendar events may take a
              few minutes to sync after you return.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                navigateAfterLink(stringParam(searchParams.link_id))
              }
            >
              Back to app
            </Button>
          </div>
        </div>
      }
    >
      <Match when={adminConsent()}>
        {(consent) => (
          <AdminConsentRequiredDialog
            open
            adminConsentUrl={consent().url}
            onClose={() => {
              const linkId = consent().linkId;
              setAdminConsent(null);
              navigateAfterLink(linkId);
            }}
            onConnectDifferentAccount={() => {
              const linkId = consent().linkId;
              setAdminConsent(null);
              openAddInboxDialog();
              navigateAfterLink(linkId);
            }}
          />
        )}
      </Match>
      <Match when={conflict()}>
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
              fireAndForget(runInit(linkId, true), 'email-auth');
            }}
          />
        )}
      </Match>
    </Switch>
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
