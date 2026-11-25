import type { BundleUpdateStatus } from '@macro/tauri';
import { match } from 'ts-pattern';

/** What the person can do about the app (over-the-air bundle) update now. */
export type BundleUpdateAction =
  | 'check'
  | 'retry'
  | 'download'
  | 'downloadAnyway'
  | 'reload'
  | 'update';

/**
 * The one action the App update row offers for `status`, or none while the
 * updater is busy or has nothing to offer. The status comes from the native
 * app, which can be newer than this bundle, so an unknown one offers nothing.
 */
export function bundleUpdateAction(
  status: BundleUpdateStatus
): BundleUpdateAction | undefined {
  return match(status)
    .returnType<BundleUpdateAction | undefined>()
    .with({ status: 'Idle' }, () => 'check')
    .with({ status: 'Error' }, () => 'retry')
    .with({ status: 'UpdateFound' }, () => 'download')
    .with({ status: 'WaitingForWifi' }, () => 'downloadAnyway')
    .with({ status: 'ClearRequired' }, () => 'reload')
    .with({ status: 'Completed' }, () => 'update')
    .with(
      { status: 'CheckingForUpdate' },
      { status: 'NoUpdateNeeded' },
      { status: 'Downloading' },
      { status: 'Unzipping' },
      { status: 'NativeUpdateRequired' },
      () => undefined
    )
    .exhaustive(() => undefined);
}
