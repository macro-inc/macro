import { redirectToEmailAuth } from '@core/auth/email';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { whenSettled } from '@core/util/whenSettled';
import { useNavigate } from '@solidjs/router';
import { onMount } from 'solid-js';

type EmailAuthParams = {
  callbackPath: string;
  successPath: string;
};

export function makeEmailAuthComponents(params: EmailAuthParams) {
  return {
    EmailCallback: () => <EmailCallback successPath={params.successPath} />,
    EmailSignUp: () => <EmailSignUp callbackPath={params.callbackPath} />,
    CALLBACK_PATH: params.callbackPath,
  };
}

function EmailCallback(props: Pick<EmailAuthParams, 'successPath'>) {
  const navigate = useNavigate();
  const { query, maybeSync } = useEmailLinks();

  whenSettled(
    query,
    (links) => {
      let result = maybeSync(links);
      if (result) {
        toast.success('Syncing email links...', 'this might take a while');
      }
      navigate(props.successPath);
    },
    (error) => {
      toast.failure(error.message);
    }
  );

  return null;
}

function EmailSignUp(props: Pick<EmailAuthParams, 'callbackPath'>) {
  const navigate = useNavigate();
  const { query: emailLinks } = useEmailLinks();

  onMount(() => {
    if (emailLinks.data && emailLinks.data?.length > 0) {
      navigate('/component/unified-list');
      return;
    }
    redirectToEmailAuth({
      returnPath: props.callbackPath,
    });
  });

  return null;
}
