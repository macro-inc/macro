import { useAnalytics } from '@app/component/analytics-context';
import { updateUserAuth } from '@core/auth';
import { redirectToEmailAuth } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { whenSettled } from '@core/util/whenSettled';
import { invalidateAllAfterLogin } from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { onMount, Suspense } from 'solid-js';

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

  const navigateToSuccess = () => {
    navigate(props.successPath, { replace: true });
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

      await initEmailLink({ linkId }).match(
        async () => {
          // Pull the newly-provisioned link into the cache before leaving the
          // callback so the inbox panel shows it immediately on return rather
          // than flashing a stale list until its own refetch lands.
          await query.refetch();
          toast.success('Inbox connected');
          navigateToSuccess();
        },
        (err) => {
          if (err.tag === 'AlreadyInitialized') {
            navigateToSuccess();
            return;
          }
          toast.failure('Failed to add inbox');
          navigateToSuccess();
        }
      );
    },
    (error) => {
      toast.failure(error.message);
      navigateToSuccess();
    }
  );

  return <LoadingBlock />;
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
