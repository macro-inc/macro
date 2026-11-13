import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';
import { match } from 'ts-pattern';

/** What a computer setup notification carries. */
export type ComputerSetupNotice = Extract<
  NotifEvent,
  { tag: 'computer_setup' }
>['content'];

/** The notices on screen, one per computer and outcome. */
const showing = new Map<string, number>();

/**
 * The in-app notice that a computer finished setup or could not be set up.
 * The buyer may have closed the setup dialog minutes ago, so it stays up a
 * minute and `open` takes them back to setup. The setup dialog's own "ready"
 * notice and the notification's are the same notice, so a second one for the
 * same computer and outcome is not shown while the first is up.
 */
export function showComputerSetupNotice(
  notice: ComputerSetupNotice,
  open: () => void
) {
  const key = `${notice.computerId}:${notice.outcome.kind}`;
  if (showing.has(key)) return;
  // The dialog it opens takes over; the notice goes.
  const openSetup = () => {
    const id = showing.get(key);
    if (id !== undefined) toast.dismiss(id);
    open();
  };
  const common = {
    titleIcon: HardDrivesIcon,
    duration: 60_000,
    onDismiss: () => showing.delete(key),
  };
  const id = match(notice.outcome)
    .with({ kind: 'ready' }, () =>
      toast.success(t('computers.setupReadyNotice'), {
        ...common,
        subtext: t('computers.setupReadyNoticeBody', {
          computer: notice.computerName,
        }),
        actions: [
          {
            label: t('computers.finishSetup'),
            variant: 'primary',
            onClick: openSetup,
          },
        ],
      })
    )
    .with({ kind: 'failed' }, ({ failureReason }) =>
      toast.failure(
        t('computers.setupFailedNotice', { computer: notice.computerName }),
        {
          ...common,
          subtext: failureReason,
          actions: [
            {
              label: t('computers.retrySetup'),
              variant: 'primary',
              onClick: openSetup,
            },
          ],
        }
      )
    )
    .exhaustive();
  if (id !== undefined) showing.set(key, id);
}
