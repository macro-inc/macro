import { t } from '@app/lib/i18n';
import type { ComputerStatus, SetupStep } from '@service-auth/computers';
import { match } from 'ts-pattern';
import { SETUP_PHASES, setupPhaseIndex } from './computer-display';

/** A stage of getting a bought computer to a working agent. */
export type SetupStageId = SetupStep | 'sign_in';

export type SetupStageState = 'done' | 'current' | 'upcoming' | 'failed';

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
 * When each computer's current setup step was first seen, since the API
 * reports the step but not when it began. The first step counts from the
 * purchase. Module-level so the row and the dialog agree, and a reopened
 * dialog keeps counting.
 */
const stepStarts = new Map<string, { step: string; at: number }>();

/** The time the computer's current step started, as best as known. */
export function setupStepStartedAt(computer: ComputerStatus): number {
  const step = currentStageId(computer);
  const known = stepStarts.get(computer.id);
  if (known && known.step === step) return known.at;
  const at =
    step === 'creating' && !known
      ? new Date(computer.createdAt).getTime()
      : Date.now();
  stepStarts.set(computer.id, { step, at });
  return at;
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
  return SETUP_PHASES[setupPhaseIndex(computer)] ?? 'creating';
}

export function setupStageLabel(stage: SetupStageId): string {
  return match(stage)
    .with('creating', () => t('computers.stepCreating'))
    .with('booting', () => t('computers.stepBooting'))
    .with('connecting', () => t('computers.stepConnecting'))
    .with('sign_in', () => t('computers.stageSignIn'))
    .with('ready', () => t('computers.ready'))
    .exhaustive();
}

/** Why a computer is not moving, when the API says so. */
export function setupProblem(computer: ComputerStatus): string | undefined {
  return match(computer.status)
    .with('failed', () => t('computers.setupFailedReason'))
    .with('needs_attention', () => t('computers.needsAttention'))
    .with('waiting_for_capacity', () => t('computers.waitingForCapacityHint'))
    .otherwise(() => undefined);
}

/**
 * The stages from purchase to a working agent, as the dialog and the row
 * show them: the three provisioning phases the API reports, then the
 * Claude sign-in when the agent runs on the team's own account.
 */
export function setupStages(
  computer: ComputerStatus,
  options: {
    /** The agent signs in to the team's own Claude account. */
    signsIn: boolean;
    /** The computer's runtime is connected, so sign-in can start. */
    connected: boolean;
    /** Claude is signed in (or credits chosen), so setup is complete. */
    signedIn: boolean;
  }
): SetupStage[] {
  const ids: SetupStageId[] = [
    ...SETUP_PHASES,
    ...(options.signsIn ? (['sign_in'] as const) : []),
  ];
  const settled = setupSettled(computer);
  const failed =
    computer.status === 'failed' || computer.status === 'needs_attention';
  const current = settled
    ? options.signsIn && !options.signedIn
      ? ids.indexOf('sign_in')
      : ids.length
    : setupPhaseIndex(computer);
  const problem = setupProblem(computer);

  return ids.map((id, index) => {
    const state: SetupStageState =
      index < current
        ? 'done'
        : index === current
          ? failed
            ? 'failed'
            : 'current'
          : 'upcoming';
    const stuck = index === current && (failed || !!problem);
    return {
      id,
      label: setupStageLabel(id),
      state,
      detail:
        id === 'sign_in' && state === 'current' && !options.connected
          ? t('computers.signInUnlocksLater')
          : stuck
            ? problem
            : undefined,
    };
  });
}
