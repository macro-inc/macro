import { t } from '@app/lib/i18n';
import type { ComputerStatus, SetupStep } from '@service-auth/computers';
import { match } from 'ts-pattern';
import { SETUP_PHASES, setupPhaseIndex } from './computer-display';

/**
 * The setup step the API reports while a purchase waits on billing. The
 * backend is adding it (name to be confirmed); until the generated
 * `SetupStep` carries it, `status: purchasing` means the same thing.
 */
export const BILLING_STEP = 'billing';

/** A stage of getting a bought computer to a working agent. */
export type SetupStageId = typeof BILLING_STEP | SetupStep | 'sign_in';

export type SetupStageState =
  | 'done'
  | 'current'
  | 'upcoming'
  | 'failed'
  /** Not needed: the agent runs on Macro's Claude. */
  | 'skipped';

export type SetupStage = {
  id: SetupStageId;
  label: string;
  state: SetupStageState;
  /** What is wrong, on a failed or stuck stage. */
  detail?: string;
};

/** "0:42", "12:05", "1:02:09". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * When each computer's current setup step was first seen here, for an API
 * that reports the step but not when it began. The first step counts from
 * the purchase. Module-level so the row and the dialog agree, and a
 * reopened dialog keeps counting.
 */
const stepStarts = new Map<string, { step: string; at: number }>();

/**
 * When the current step began, as the API reports it (`setup.stepStartedAt`,
 * being added) or else as first seen here.
 */
export function setupStepStartedAt(computer: ComputerStatus): number {
  const reported: unknown = computer.setup
    ? Reflect.get(computer.setup, 'stepStartedAt')
    : undefined;
  if (typeof reported === 'string') {
    const at = Date.parse(reported);
    if (!Number.isNaN(at)) return at;
  }

  const step = currentStageId(computer);
  const known = stepStarts.get(computer.id);
  if (known && known.step === step) return known.at;
  const at =
    step === BILLING_STEP && !known
      ? new Date(computer.createdAt).getTime()
      : Date.now();
  stepStarts.set(computer.id, { step, at });
  return at;
}

/** The purchase is still waiting on billing: the first live stage. */
export function billingPending(computer: ComputerStatus): boolean {
  const step: string | undefined = computer.setup?.step;
  return computer.status === 'purchasing' || step === BILLING_STEP;
}

/** Forget a computer's timing, once setup is over or in tests. */
export function forgetSetupTiming(computerId: string) {
  stepStarts.delete(computerId);
}

/** Setup is over for good: the computer is up, or gone. */
export function setupSettled(computer: ComputerStatus): boolean {
  return match(computer.status)
    .with('ready', 'stopped', 'starting', 'stopping', 'released', () => true)
    .with(
      'purchasing',
      'setting_up',
      'waiting_for_capacity',
      'failed',
      'needs_attention',
      () => false
    )
    .exhaustive(() => false);
}

function currentStageId(computer: ComputerStatus): SetupStageId {
  if (setupSettled(computer)) return 'ready';
  if (billingPending(computer)) return BILLING_STEP;
  return SETUP_PHASES[setupPhaseIndex(computer)] ?? 'creating';
}

export function setupStageLabel(stage: SetupStageId): string {
  return match(stage)
    .with(BILLING_STEP, () => t('computers.stageBilling'))
    .with('creating', () => t('computers.stepCreating'))
    .with('booting', () => t('computers.stepBooting'))
    .with('connecting', () => t('computers.stepConnecting'))
    .with('sign_in', () => t('computers.stageSignIn'))
    .with('ready', () => t('computers.ready'))
    .exhaustive();
}

/** A stage that is behind the computer, in words that say it is done. */
export function setupStageDoneLabel(stage: SetupStageId): string {
  return match(stage)
    .with(BILLING_STEP, () => t('computers.stageBillingDone'))
    .with('creating', () => t('computers.stepCreatingDone'))
    .with('booting', () => t('computers.stepBootingDone'))
    .with('connecting', () => t('computers.stepConnectingDone'))
    .with('sign_in', () => t('computers.stageSignInDone'))
    .with('ready', () => t('computers.ready'))
    .exhaustive();
}

/**
 * The server's reason for a failed setup (`failureReason`, null until the
 * fail-fast Failed state lands in the API).
 */
export function setupFailureReason(
  computer: ComputerStatus
): string | undefined {
  const reason: unknown = Reflect.get(computer, 'failureReason');
  return typeof reason === 'string' && reason.trim() ? reason : undefined;
}

/** Why a computer is not moving, when the API says so. */
export function setupProblem(computer: ComputerStatus): string | undefined {
  return match(computer.status)
    .with('failed', () =>
      [setupFailureReason(computer), t('computers.setupFailedReason')]
        .filter(Boolean)
        .join(' ')
    )
    .with('needs_attention', () => t('computers.needsAttention'))
    .with('waiting_for_capacity', () => t('computers.waitingForCapacityHint'))
    .otherwise(() => undefined);
}

/** Whether the agent signs in to the team's own Claude account. */
export type SignInPlan = 'needed' | 'skipped' | 'undecided';

/**
 * The stages from purchase to a working agent, the same list on every
 * step: the billing wait, the three provisioning phases the API reports,
 * then the Claude sign-in, struck through when the agent runs on Macro's
 * Claude.
 */
export function setupStages(
  computer: ComputerStatus,
  options: {
    signIn: SignInPlan;
    /** The computer's runtime is connected, so sign-in can start. */
    connected: boolean;
    /** Claude is signed in (or credits chosen), so setup is complete. */
    signedIn: boolean;
  }
): SetupStage[] {
  const ids: SetupStageId[] = [BILLING_STEP, ...SETUP_PHASES, 'sign_in'];
  const settled = setupSettled(computer);
  const failed =
    computer.status === 'failed' || computer.status === 'needs_attention';
  const current = settled
    ? options.signIn === 'needed' && !options.signedIn
      ? ids.indexOf('sign_in')
      : ids.length
    : billingPending(computer)
      ? 0
      : 1 + setupPhaseIndex(computer);
  const problem = setupProblem(computer);

  return ids.map((id, index) => {
    const state: SetupStageState =
      id === 'sign_in' && options.signIn === 'skipped'
        ? 'skipped'
        : index < current
          ? 'done'
          : index === current
            ? failed
              ? 'failed'
              : 'current'
            : 'upcoming';
    const stuck = index === current && (failed || !!problem);
    return {
      id,
      label:
        state === 'done'
          ? setupStageDoneLabel(id)
          : state === 'skipped'
            ? t('computers.stageSkipped', { stage: setupStageLabel(id) })
            : setupStageLabel(id),
      state,
      detail:
        state === 'skipped'
          ? t('computers.signInSkipped')
          : id === 'sign_in' && state === 'current' && !options.connected
            ? t('computers.signInUnlocksLater')
            : stuck
              ? problem
              : undefined,
    };
  });
}
