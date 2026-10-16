/** App adapter: sign in from the respond page, then land back on it. */
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { useNavigate } from '@solidjs/router';
import type { ParentProps } from 'solid-js';

export function SignInToRespond(props: ParentProps<{ class?: string }>) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      class={props.class ?? 'text-link hover:underline'}
      onClick={() => {
        // Restored after authentication, as other deep links are.
        setPostLoginRedirect(window.location.href);
        navigate('/login');
      }}
    >
      {props.children}
    </button>
  );
}
