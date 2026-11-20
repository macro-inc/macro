import type { ComputerStatus } from '@service-auth/computers';
import { match } from 'ts-pattern';

/**
 * How long a Buy or Add waits in its dialog for the computer (or agent) to
 * come up. Past it, the dialog closes and setup carries on where it shows.
 */
export const PURCHASE_WAIT_MS = 5000;

/** How often a waiting dialog reads the status again. */
export const PURCHASE_POLL_MS = 500;

/** Where a just-bought computer is, for the dialog waiting on it. */
export type BoughtComputerProgress = 'waiting' | 'ready' | 'failed' | 'gone';

/** The progress of computer `computerId` in the team's list. */
export function boughtComputerProgress(
  computers: readonly Pick<ComputerStatus, 'id' | 'status'>[],
  computerId: string
): BoughtComputerProgress {
  const computer = computers.find((item) => item.id === computerId);
  if (!computer) return 'waiting';
  return (
    match(computer.status)
      .returnType<BoughtComputerProgress>()
      .with(
        'purchasing',
        'setting_up',
        'waiting_for_capacity',
        'starting',
        () => 'waiting'
      )
      .with('ready', 'unhealthy', 'stopping', 'stopped', () => 'ready')
      .with('failed', 'needs_attention', () => 'failed')
      .with('released', () => 'gone')
      // A status a newer server sends keeps waiting, into the slow path.
      .exhaustive(() => 'waiting')
  );
}
