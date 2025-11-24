import { redirectToEmailAuth } from '@core/auth/email';
import { useEmailLinks } from '@core/email-link';
import { useNavigate } from '@solidjs/router';
import { onMount } from 'solid-js';

const RETURN_PATH = '/app/email-signup-callback';

export function EmailSignUp() {
  const emailLinks = useEmailLinks();
  const navigate = useNavigate();

  onMount(() => {
    if (emailLinks.data && emailLinks.data?.length > 0) {
      navigate('/component/unified-list');
      return;
    }
    redirectToEmailAuth({
      returnPath: RETURN_PATH,
    });
  });

  return null;
}
