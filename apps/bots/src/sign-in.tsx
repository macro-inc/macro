import { A, useLocation, useNavigate } from '@solidjs/router';
import { createResource, createSignal, Show } from 'solid-js';
import { hireReturnUrl, markFixtureHireSignIn } from './draft';
import { editIntent, parseReturnIntent, returnPath } from './return-intent';
import { session } from './session';

export default function SignIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draftExpired, setDraftExpired] = createSignal(false);
  const [state] = createResource(
    () => location.search,
    (search) => {
      const params = new URLSearchParams(search);
      const handoffs = params.getAll('handoff');
      params.delete('handoff');
      const intent = parseReturnIntent(params.toString());
      const handoff =
        handoffs.length === 1 &&
        /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/.test(handoffs[0])
          ? handoffs[0]
          : undefined;
      const path = returnPath(intent ?? editIntent);

      const hireHandoff =
        intent?.route === 'creator' && intent.action === 'hire'
          ? handoff
          : undefined;

      return session.startSignIn({ original_url: path }).then((result) => ({
        result,
        hireHandoff,
        back: hireHandoff
          ? hireReturnUrl(hireHandoff)
          : returnPath(
              intent?.route === 'creator' ? editIntent : (intent ?? editIntent)
            ),
      }));
    }
  );

  return (
    <section class="panel sign-in">
      <h1>Sign in with Macro</h1>
      {__BOTS_FIXTURES__ ? (
        <Show when={state()?.hireHandoff}>
          {(handoff) => (
            <>
              <p>Sample account and team. No service purchases.</p>
              <button
                type="button"
                class="primary"
                onClick={() => {
                  try {
                    if (markFixtureHireSignIn(sessionStorage, handoff())) {
                      navigate(hireReturnUrl(handoff()), { replace: true });
                      return;
                    }
                  } catch {
                    // Use the same recovery when tab storage is unavailable.
                  }
                  setDraftExpired(true);
                }}
              >
                Continue with sample account
              </button>
              <Show when={draftExpired()}>
                <p role="status">
                  The draft expired or is unavailable in this tab.
                </p>
              </Show>
            </>
          )}
        </Show>
      ) : null}
      <Show
        when={
          (!__BOTS_FIXTURES__ || !state()?.hireHandoff) &&
          state()?.result.status === 'unavailable'
        }
      >
        <p>Macro sign-in is unavailable in this preview.</p>
      </Show>
      <A href={state()?.back ?? '/'} replace>
        Go back
      </A>
    </section>
  );
}
