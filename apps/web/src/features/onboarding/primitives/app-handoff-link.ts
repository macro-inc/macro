import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup } from 'solid-js';
import type { OnboardingContext } from '../context/onboarding-context';
import {
  type AppHandoff,
  type AppHandoffLink,
  appSignInUrl,
} from '../core/app-handoff';

/** A session code lives five minutes; mint the next one before it lapses. */
export const REMINT_AFTER_MS = 4 * 60 * 1000;

/** Long enough for the browser to follow the link before it changes. */
export const REMINT_AFTER_OPEN_MS = 1000;

/**
 * Keeps a fresh `macro:///login?token=` link for the app that is waiting on
 * this sign-up. The link is minted ahead, so opening it is an ordinary tap
 * on a link: the browser asks whether to open the app only for a navigation
 * the user started, and minting on the tap would put a request between the
 * two. A code redeems once and lives five minutes, so a new one replaces it
 * before it lapses, when the page comes back after a long time hidden (timers
 * pause in a hidden tab), and shortly after each open, in case the first
 * open never reached the app.
 */
export function createAppHandoffLink(
  context: Pick<OnboardingContext, 'mintAppSessionCode'>,
  handoff: AppHandoff,
  now: () => number = Date.now
) {
  const [link, setLink] = createSignal<AppHandoffLink>({ t: 'minting' });
  let mintedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => fireAndForget(mint(), 'onboarding'), delay);
  };

  async function mint() {
    clearTimeout(timer);
    const attempt = ++generation;
    mintedAt = undefined;
    setLink({ t: 'minting' });
    const code = await context.mintAppSessionCode(handoff);
    // A newer mint started meanwhile (a retry, a return to the page).
    if (attempt !== generation) return;
    if (code === undefined) {
      setLink({ t: 'failed' });
      return;
    }
    mintedAt = now();
    setLink({ t: 'ready', href: appSignInUrl(code, handoff.handoffId) });
    schedule(REMINT_AFTER_MS);
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (mintedAt !== undefined && now() - mintedAt >= REMINT_AFTER_MS)
      fireAndForget(mint(), 'onboarding');
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  onCleanup(() => {
    generation++;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  fireAndForget(mint(), 'onboarding');

  return {
    link,
    /** The link was just opened; its code may now be spent. */
    opened: () => schedule(REMINT_AFTER_OPEN_MS),
    retry: () => fireAndForget(mint(), 'onboarding'),
  };
}
