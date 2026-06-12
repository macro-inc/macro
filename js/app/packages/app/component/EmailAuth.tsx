import { useAnalytics } from '@app/component/analytics-context';
import { updateUserAuth } from '@core/auth';
import { redirectToEmailAuth } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useEmailLinks } from '@core/email-link';
import { whenSettled } from '@core/util/whenSettled';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
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
    const channel = new BroadcastChannel('auth');
    channel.postMessage({ type: 'login-success' });
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
 * Handles the OAuth callback after an already-authenticated user adds another Gmail
 * inbox via /link/gmail. Reads `link_id` from the query string and invokes init to
 * provision the second `email_links` row. Falls back to a toast on failure.
 */
function EmailLinkCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { query, initEmailLink } = useEmailLinks();
  const { setActiveTabId } = useSettingsState();
  const [conflict, setConflict] = createSignal<{
    linkId: string;
    emailAddress: string;
    ownerEmail: string;
  } | null>(null);

  const navigateToSuccess = () => {
    navigate(props.successPath, { replace: true });
  };

  const navigateToAccountSettings = () => {
    setActiveTabId('Account');
    navigate('/component/mail/component/settings', { replace: true });
  };

  const runInit = async (linkId: string, forceShare: boolean) => {
    await initEmailLink({ linkId, forceShare }).match(
      async () => {
        // Pull the newly-provisioned link into the cache before leaving the
        // callback so the inbox panel shows it immediately on return rather
        // than flashing a stale list until its own refetch lands.
        await query.refetch();
        toast.success('Inbox connected', {
          subtext: 'Syncing emails — refresh to see them',
        });
        navigateToAccountSettings();
      },
      async (err) => {
        if (err.tag === 'AlreadyInitialized') {
          await query.refetch();
          navigateToAccountSettings();
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
        toast.failure('Failed to add inbox');
        navigateToSuccess();
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConflict(null);
              navigateToSuccess();
            }
          }}
          position="center"
          class="w-120"
        >
          <Panel active depth={2} class="rounded-xl">
            <Panel.Header class="px-6">
              <Dialog.Title class="text-ink text-sm font-semibold">
                Share this inbox?
              </Dialog.Title>
            </Panel.Header>
            <Panel.Body class="p-6 font-sans flex flex-col gap-3">
              <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
                <span class="text-ink">{c().emailAddress}</span> is already
                connected by <span class="text-ink">{c().ownerEmail}</span>.
                Share it so you both manage one inbox instead of syncing a
                duplicate copy.
              </Dialog.Description>
              <div class="pt-3 justify-end items-center gap-3 inline-flex">
                <Button
                  variant="base"
                  depth={3}
                  onClick={() => {
                    setConflict(null);
                    navigateToSuccess();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="active"
                  depth={3}
                  onClick={() => {
                    const linkId = c().linkId;
                    setConflict(null);
                    void runInit(linkId, true);
                  }}
                >
                  Share inbox
                </Button>
              </div>
            </Panel.Body>
          </Panel>
        </Dialog>
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
