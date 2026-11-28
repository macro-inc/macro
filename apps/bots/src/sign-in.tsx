import { A, useLocation, useNavigate } from '@solidjs/router';
import { createMemo, createSignal, Show } from 'solid-js';
import { hireReturnUrl, markFixtureHireSignIn } from './draft';
import {
  editIntent,
  macroLoginPath,
  parseReturnIntent,
  returnPath,
} from './return-intent';
import { useSession } from './session';

export default function SignIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draftExpired, setDraftExpired] = createSignal(false);
  const identity = useSession();
  const state = createMemo(() => {
    const params = new URLSearchParams(location.search);
    const handoffs = params.getAll('handoff');
    params.delete('handoff');
    const intent = parseReturnIntent(params.toString());
    const handoff =
      handoffs.length === 1 &&
      /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/.test(handoffs[0])
        ? handoffs[0]
        : undefined;
    const hireHandoff =
      intent?.route === 'creator' && intent.action === 'hire'
        ? handoff
        : undefined;

    return {
      hireHandoff,
      macroHref: macroLoginPath(intent ?? editIntent, hireHandoff),
      back: hireHandoff
        ? hireReturnUrl(hireHandoff)
        : returnPath(
            intent?.route === 'creator' ? editIntent : (intent ?? editIntent)
          ),
    };
  });

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
          __BOTS_NATIVE__ &&
          state()?.macroHref &&
          identity()?.status === 'signed-out'
        }
      >
        <a class="primary" href={state()?.macroHref} rel="external">
          Sign in with Macro
        </a>
      </Show>
      <Show when={__BOTS_NATIVE__ && identity()?.status === 'signed-in'}>
        <A class="primary" href={state()?.back ?? '/'} replace>
          Continue
        </A>
      </Show>
      <Show when={__BOTS_NATIVE__ && identity()?.status === 'team-unresolved'}>
        <p role="status">Macro could not verify your team.</p>
      </Show>
      <Show
        when={
          (!__BOTS_NATIVE__ && !__BOTS_FIXTURES__) ||
          identity()?.status === 'unavailable'
        }
      >
        <p>Macro sign-in is unavailable.</p>
      </Show>
      <A href={__BOTS_FIXTURES__ ? state().back : '/'} replace>
        Back to Creator
      </A>
    </section>
  );
}
