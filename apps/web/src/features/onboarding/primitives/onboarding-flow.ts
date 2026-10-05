import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type {
  Loadable,
  OnboardingContext,
  OnboardingRecord,
  Viewer,
} from '../context/onboarding-context';
import type { CheckoutReturn } from '../core/checkout';
import {
  nextOnboardingStep,
  ONBOARDING_STEPS,
  type OnboardingStep,
  restoreOnboardingStep,
  type StepOutcome,
} from '../core/steps';
import {
  clearSignupDraft,
  readSavedStep,
  readSignupDraft,
  saveStep,
} from './flow-storage';

type FlowCapabilities = Pick<
  OnboardingContext,
  'viewer' | 'applyAccent' | 'repairTutorial' | 'track'
>;

/** Where the flow stands for the signed-in viewer. */
export type FlowStatus =
  | { t: 'loading' }
  | { t: 'signed-out' }
  /** Onboarding is already done; the host should leave. */
  | { t: 'complete' }
  | { t: 'active'; viewer: Viewer; step: OnboardingStep };

/**
 * The step machine: restores progress across OAuth/Stripe round-trips, saves
 * every step, and reports the funnel. Motion between steps belongs to the view,
 * which calls `commit` once its transition is ready to swap content.
 */
export function createOnboardingFlow(
  context: FlowCapabilities,
  options: {
    checkoutReturn: Accessor<CheckoutReturn | undefined>;
    record: Accessor<Loadable<OnboardingRecord>>;
    /** Whether the viewer signed up with Google (has an inbox) or an email code. */
    signupMethod: Accessor<'google' | 'email_code' | undefined>;
    /** While leaving, a completed tutorial is the flow's own doing. */
    finishing: Accessor<boolean>;
  }
) {
  const [step, setStep] = createSignal<OnboardingStep>();
  const index = () => {
    const current = step();
    return current ? ONBOARDING_STEPS.indexOf(current) : -1;
  };

  const viewer = (): Viewer | undefined => {
    const state = context.viewer();
    return state.t === 'signed-in' ? state.viewer : undefined;
  };
  const needsOnboarding = () => viewer()?.tutorialComplete === false;

  // Restore once per viewer: the signed-out draft's OAuth return wins, then
  // saved progress; a checkout return always lands on the plan step.
  createEffect(
    on(
      () => viewer()?.id,
      (userId) => {
        if (!userId || step()) return;
        const draft = readSignupDraft();
        const initial = restoreOnboardingStep(
          draft?.authenticating ? 'work' : readSavedStep(userId),
          options.checkoutReturn() !== undefined
        );
        saveStep(userId, initial);
        if (draft?.authenticating && draft.accent)
          context.applyAccent(draft.accent, userId);
        clearSignupDraft();
        setStep(initial);
      }
    )
  );

  let started = false;
  createEffect(() => {
    const current = step();
    const method = options.signupMethod();
    if (!current || !needsOnboarding() || started || !method) return;
    started = true;
    context.track('onboarding_v4_started', {
      signup_method: method,
      entry_step: current,
    });
  });

  createEffect(
    on(step, (current) => {
      if (current && needsOnboarding())
        context.track('onboarding_v4_step', {
          step: current,
          index: index(),
          state: 'viewed',
        });
    })
  );

  // Repair partially completed setup without sending the user into a redirect
  // loop: the server says done but the tutorial flag never landed.
  let repairing = false;
  createEffect(() => {
    const record = options.record();
    if (
      repairing ||
      !needsOnboarding() ||
      record.t !== 'ready' ||
      record.value.status !== 'completed'
    )
      return;
    repairing = true;
    context.repairTutorial().catch(() => {
      repairing = false;
    });
  });

  const status = (): FlowStatus => {
    const state = context.viewer();
    if (state.t === 'loading') return { t: 'loading' };
    if (state.t === 'signed-out') return { t: 'signed-out' };
    if (!state.viewer.tutorialComplete || options.finishing()) {
      const current = step();
      return current
        ? { t: 'active', viewer: state.viewer, step: current }
        : { t: 'loading' };
    }
    return { t: 'complete' };
  };

  /** Show `next` and save it as the step to resume. */
  const commit = (next: OnboardingStep) => {
    const userId = viewer()?.id;
    if (userId) saveStep(userId, next);
    setStep(next);
  };

  /** Record how the user left the current step and return where to go next. */
  const leave = (outcome: StepOutcome): OnboardingStep | undefined => {
    const current = step();
    if (!current) return undefined;
    context.track('onboarding_v4_step', {
      step: current,
      index: index(),
      state: outcome,
    });
    return nextOnboardingStep(current, outcome);
  };

  return { status, step, index, commit, leave };
}
