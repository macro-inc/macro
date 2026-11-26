import { A, useLocation } from '@solidjs/router';
import { createMemo, createSignal, Show } from 'solid-js';
import { hireReturnUrl } from './draft';
import { parseReturnIntent } from './return-intent';
import { type SessionResult, session } from './session';

export default function SignIn() {
  const location = useLocation();
  const [waitingForCode, setWaitingForCode] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<SessionResult>();

  const back = createMemo(() => {
    const params = new URLSearchParams(location.search);
    const handoffs = params.getAll('handoff');
    params.delete('handoff');
    const intent = parseReturnIntent(params.toString());
    const handoff = handoffs[0];
    if (
      intent?.route === 'creator' &&
      intent.action === 'hire' &&
      handoffs.length === 1 &&
      /^[a-f\d-]{36}$/.test(handoff)
    )
      return hireReturnUrl(handoff);
    return intent?.route === 'fleet' ? '/fleet' : '/';
  });

  async function begin() {
    setBusy(true);
    setResult(undefined);
    const sent = await session.begin();
    setWaitingForCode(sent);
    if (!sent) setResult({ status: 'unavailable' });
    setBusy(false);
  }

  async function complete(
    event: SubmitEvent & { currentTarget: HTMLFormElement }
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = new FormData(form).get('code');
    form.reset();
    if (typeof code !== 'string') return;
    setBusy(true);
    setResult(await session.complete(code));
    setWaitingForCode(false);
    setBusy(false);
  }

  return (
    <section class="panel sign-in">
      <h1>Sign in with Macro</h1>
      <Show
        when={__BOTS_LOCAL_AUTH__}
        fallback={<p>Macro sign-in is unavailable in this preview.</p>}
      >
        <Show when={result()?.status !== 'signed-in'}>
          <Show
            when={waitingForCode()}
            fallback={
              <button type="button" onClick={begin} disabled={busy()}>
                Send local reviewer code
              </button>
            }
          >
            <form method="post" onSubmit={complete}>
              <label for="bots-review-code">Reviewer code</label>
              <input
                id="bots-review-code"
                name="code"
                type="password"
                required
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
              />
              <button type="submit" disabled={busy()}>
                Sign in
              </button>
            </form>
          </Show>
        </Show>
        <Show when={result()?.status === 'signed-in'}>
          <p role="status">Signed in as the local reviewer.</p>
        </Show>
        <Show when={result()?.status === 'rejected'}>
          <p role="alert">
            That code could not be verified. Request a new one.
          </p>
        </Show>
        <Show when={result()?.status === 'team-unresolved'}>
          <p role="alert">The local reviewer team could not be verified.</p>
        </Show>
        <Show when={result()?.status === 'unavailable'}>
          <p role="alert">Local sign-in is unavailable.</p>
        </Show>
      </Show>
      <A href={back()} replace>
        {result()?.status === 'signed-in' ? 'Continue' : 'Go back'}
      </A>
    </section>
  );
}
