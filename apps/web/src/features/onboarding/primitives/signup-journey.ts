import { createSignal } from 'solid-js';
import type { SignupStep } from '../core/signup-draft';
import { readSignupDraft, saveSignupDraft } from './flow-storage';

/**
 * The signed-out slides. Only the step and accent cross the Google sign-up
 * redirect; the flow resumes at the work step once the account exists.
 */
export function createSignupJourney(options: { showingEmail: boolean }) {
  const draft = readSignupDraft();
  const [step, setStep] = createSignal<SignupStep>(
    options.showingEmail ? 'work' : (draft?.step ?? 'welcome')
  );
  const [accent, setAccent] = createSignal(draft?.accent);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string>();

  /** Show `next`; moving between slides drops any pending sign-up. */
  const commit = (next: SignupStep) => {
    saveSignupDraft({ step: next, accent: accent() });
    setStep(next);
  };

  const connectGoogle = async (startSignup: () => Promise<void>) => {
    if (connecting()) return;
    saveSignupDraft({ step: 'work', accent: accent(), authenticating: true });
    setConnecting(true);
    setError();
    try {
      await startSignup();
    } catch {
      setError("Couldn't open Google. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  return {
    step,
    accent,
    setAccent,
    commit,
    connecting,
    error,
    connectGoogle,
  };
}
