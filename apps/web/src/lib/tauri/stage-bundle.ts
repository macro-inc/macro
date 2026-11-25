import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { match } from 'ts-pattern';
import type { BundleUpdateStatus } from './TauriProvider';

/** How long Restart to update waits for the deployed web bundle. */
export const STAGE_BUNDLE_TIMEOUT_MS = 10_000;

export type StageOutcome =
  | 'staged'
  | 'up_to_date'
  | 'not_staged'
  | 'timed_out'
  | 'failed';

/**
 * What a bundle check status means for staging; unset while it runs. The
 * status comes from the native updater, which ships separately, so a status
 * this page doesn't know keeps it waiting until the timeout.
 */
function stageOutcome(status: BundleUpdateStatus): StageOutcome | undefined {
  return match(status.status)
    .with('Completed', () => 'staged' as const)
    .with('NoUpdateNeeded', () => 'up_to_date' as const)
    .with(
      'Error',
      'ClearRequired',
      'NativeUpdateRequired',
      'WaitingForWifi',
      () => 'not_staged' as const
    )
    .with(
      'Idle',
      'CheckingForUpdate',
      'UpdateFound',
      'Downloading',
      'Unzipping',
      () => undefined
    )
    .exhaustive(() => undefined);
}

/**
 * Downloads the deployed web bundle before Restart to update installs the
 * desktop app update. The embedded bundle of a new desktop release is older
 * than the deployed one, so without this the first launch downloads it and
 * asks for a second restart. The download stays pending, and the new launch
 * starts on it before its first document loads. Waits at most `timeoutMs`;
 * the restart goes ahead whatever the check finds.
 */
export function stageDeployedBundle(
  timeoutMs = STAGE_BUNDLE_TIMEOUT_MS
): Promise<StageOutcome> {
  return Telemetry.span('native.update.stage_bundle', async (span) => {
    const outcome = await checkForBundle(timeoutMs);
    span.setAttr('native.update.stage_bundle.outcome', outcome);
    return outcome;
  });
}

/**
 * Settles at the first status that ends the check, or at the deadline, even
 * while the listener registration or the check command is still unanswered.
 */
async function checkForBundle(timeoutMs: number): Promise<StageOutcome> {
  let settled = false;
  let finish: (outcome: StageOutcome) => void = () => {};
  const finished = new Promise<StageOutcome>((resolve) => {
    finish = (outcome) => {
      settled = true;
      resolve(outcome);
    };
  });
  const timer = setTimeout(() => finish('timed_out'), timeoutMs);
  fireAndForget(
    startCheck(finished, finish, () => settled),
    'native-updates'
  );

  const outcome = await finished;
  clearTimeout(timer);
  return outcome;
}

/**
 * Listens before starting the check, so its last status can't be missed. A
 * registration that answers after staging ended starts nothing.
 */
async function startCheck(
  finished: Promise<StageOutcome>,
  finish: (outcome: StageOutcome) => void,
  settled: () => boolean
): Promise<void> {
  let unlisten: UnlistenFn;
  try {
    unlisten = await listen<BundleUpdateStatus>(
      'bundle-update-status',
      (event) => {
        const outcome = stageOutcome(event.payload);
        if (outcome) finish(outcome);
      }
    );
  } catch {
    finish('failed');
    return;
  }
  fireAndForget(unlistenWhenDone(finished, unlisten), 'native-updates');
  if (settled()) return;

  try {
    await invoke('check_for_update');
  } catch {
    finish('failed');
  }
}

async function unlistenWhenDone(
  finished: Promise<StageOutcome>,
  unlisten: UnlistenFn
): Promise<void> {
  await finished;
  await unlisten();
}
