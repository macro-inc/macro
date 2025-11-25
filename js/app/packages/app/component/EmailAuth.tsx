import { updateUserAuth } from '@core/auth';
import { redirectToEmailAuth } from '@core/auth/email';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { whenSettled } from '@core/util/whenSettled';
import { updateUserInfo } from '@service-gql/client';
import { useNavigate } from '@solidjs/router';
import { onMount, Suspense } from 'solid-js';

type EmailAuthParams = {
  callbackPath: string;
  successPath: string;
};

export function makeEmailAuthComponents(params: EmailAuthParams) {
  return {
    EmailCallback: () => (
      <Suspense>
        <EmailCallback successPath={params.successPath} />
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
    CALLBACK_PATH: params.callbackPath,
  };
}

function EmailCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const { query, maybeSync } = useEmailLinks();

  const onSuccessfulAuth = async () => {
    await updateUserAuth();
    await updateUserInfo();
    const channel = new BroadcastChannel('auth');
    channel.postMessage({ type: 'login-success' });
  };

  whenSettled(
    query,
    async (links) => {
      let result = maybeSync(links);
      if (result) {
        toast.success('Syncing emails', 'this might take a while');
      }
      onSuccessfulAuth();
      navigate(props.successPath, {
        replace: true,
      });
    },
    (error) => {
      toast.failure(error.message);
    }
  );

  return <LoadingBlock />;
}

function EmailSignUp(props: EmailAuthParams) {
  const navigate = useNavigate();
  const { query: emailLinks } = useEmailLinks();

  const withAppPrefix = (path: string) => `/app${path}`;

  onMount(() => {
    if (emailLinks.data && emailLinks.data?.length > 0) {
      navigate(props.successPath);
      return;
    }
    redirectToEmailAuth({
      returnPath: withAppPrefix(props.callbackPath),
    });
  });
  return <LoadingBlock />;
}
