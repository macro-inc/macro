import { A, useLocation } from '@solidjs/router';
import { createResource, Show } from 'solid-js';
import { hireReturnUrl } from './draft';
import { editIntent, parseReturnIntent, returnPath } from './return-intent';
import { session } from './session';

export default function SignIn() {
  const location = useLocation();
  const [state] = createResource(
    () => location.search,
    (search) => {
      const params = new URLSearchParams(search);
      const handoffs = params.getAll('handoff');
      params.delete('handoff');
      const intent = parseReturnIntent(params.toString());
      const handoff =
        handoffs.length === 1 && /^[a-f\d-]{36}$/.test(handoffs[0])
          ? handoffs[0]
          : undefined;
      const path = returnPath(intent ?? editIntent);

      return session.startSignIn({ original_url: path }).then((result) => ({
        result,
        back:
          intent?.route === 'creator' && intent.action === 'hire' && handoff
            ? hireReturnUrl(handoff)
            : path === '/fleet'
              ? '/fleet'
              : '/',
      }));
    }
  );

  return (
    <section class="panel sign-in">
      <h1>Sign in with Macro</h1>
      <Show when={state()?.result.status === 'unavailable'}>
        <p>Macro sign-in is unavailable in this preview.</p>
      </Show>
      <A href={state()?.back ?? '/'} replace>
        Go back
      </A>
    </section>
  );
}
