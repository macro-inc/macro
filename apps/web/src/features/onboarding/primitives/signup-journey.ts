import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type { SignupStep } from '../core/signup-draft';
import { readSignupDraft, saveSignupDraft } from './flow-storage';

/** The identity providers a new account can sign up with. */
export type SignupProvider = 'google' | 'microsoft';

/**
 * The signed-out slides. Only the step and accent cross the Google or
 * Microsoft sign-up redirect; the flow resumes at the work step once the account exists.
 */
export function createSignupJourney(options: { showingEmail: boolean }) {
  const draft = readSignupDraft();
  const [step, setStep] = createSignal<SignupStep>(
    options.showingEmail ? 'work' : (draft?.step ?? 'welcome')
  );
  const [accent, setAccent] = createSignal(draft?.accent);
  const [connecting, setConnecting] = createSignal<SignupProvider>();
  const [error, setError] = createSignal<string>();

  /** Show `next`; moving between slides drops any pending sign-up. */
  const commit = (next: SignupStep) => {
    saveSignupDraft({ step: next, accent: accent() });
    setStep(next);
  };

  const connect = async (
    provider: SignupProvider,
    startSignup: () => Promise<void>
  ) => {
    if (connecting()) return;
    saveSignupDraft({ step: 'work', accent: accent(), authenticating: true });
    setConnecting(provider);
    setError();
    try {
      await startSignup();
    } catch {
      const name = match(provider)
        .with('google', () => 'Google')
        .with('microsoft', () => 'Microsoft')
        .exhaustive();
      setError(`Couldn't open ${name}. Please try again.`);
    } finally {
      setConnecting();
    }
  };

  return {
    step,
    accent,
    setAccent,
    commit,
    connecting,
    error,
    connect,
  };
}
