import { type Component, createSignal, onMount, Show } from 'solid-js';
import { setPageSeo } from '../utils/utilSeo';

const FORWARDED_AT_KEY = 'mobile-signup-forwarded-at';
/** A second visit this soon means the app sent the visitor straight back. */
const LOOP_WINDOW_MS = 2 * 60 * 1000;

function forwardedRecently(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(FORWARDED_AT_KEY));
    return Number.isFinite(at) && now - at < LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function rememberForward(now: number) {
  try {
    sessionStorage.setItem(FORWARDED_AT_KEY, String(now));
  } catch {
    // Blocked storage only loses the loop guard.
  }
}

/**
 * `/mobile-signup` and `/mobile-signup-sent` once held the phone email
 * capture. Phones now sign up in the app like desktop, so old links (ads,
 * emails, bookmarks) forward there with their query intact for attribution.
 *
 * An app build from before this change sends phones from `/app/signup` back
 * here, so while a release is half deployed the two would bounce forever. A
 * second arrival within two minutes stops and offers a link instead.
 */
export const RouteMobileSignupRedirect: Component = () => {
  setPageSeo({
    title: 'Start for free — Macro',
    description: 'Create your Macro workspace.',
    path: '/mobile-signup',
    noindex: true,
  });
  const [bounced, setBounced] = createSignal(false);
  const signupHref = () =>
    `/app/signup${typeof window === 'undefined' ? '' : window.location.search}`;
  onMount(() => {
    const now = Date.now();
    if (forwardedRecently(now)) {
      setBounced(true);
      return;
    }
    rememberForward(now);
    window.location.replace(signupHref());
  });
  return (
    <Show when={bounced()}>
      <section
        style={{
          'align-items': 'center',
          color: 'var(--c0)',
          display: 'grid',
          'font-family': 'body',
          gap: '16px',
          'justify-items': 'center',
          'min-height': '60dvh',
          padding: '24px',
          'text-align': 'center',
        }}
      >
        <p style={{ margin: 0 }}>Macro is updating. Try again in a minute.</p>
        <a
          href={signupHref()}
          target="_self"
          style={{ color: 'var(--c1)', 'text-decoration': 'underline' }}
        >
          Continue to sign up
        </a>
      </section>
    </Show>
  );
};
