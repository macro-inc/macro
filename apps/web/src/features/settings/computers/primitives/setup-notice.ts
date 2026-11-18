import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { queryClient } from '@queries/client';
import { computerKeys } from '@queries/computers/keys';
import type { ComputerStatus } from '@service-auth/computers';
import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';
import { match } from 'ts-pattern';

/** What a computer setup notification carries. */
export type ComputerSetupNotice = Extract<
  NotifEvent,
  { tag: 'computer_setup' }
>['content'];

/** The notices on screen, one per computer and outcome. */
const showing = new Map<string, number>();

/** Computers whose buy dialog is open; it shows their progress itself. */
const inDialog = new Set<string>();

/**
 * Keep the "ready, finish setup" notice away while `computerId`'s buy dialog
 * is open, and take down one already up. Returns the release.
 */
export function holdSetupNotices(computerId: string): () => void {
  inDialog.add(computerId);
  const id = showing.get(`${computerId}:ready`);
  if (id !== undefined) toast.dismiss(id);
  return () => inDialog.delete(computerId);
}

/** Whether the team's cached list says `computerId` finished its setup. */
function setupComplete(computerId: string): boolean {
  return !!queryClient
    .getQueryData<ComputerStatus[]>(computerKeys.list.queryKey)
    ?.find((computer) => computer.id === computerId)?.setupCompletedAt;
}

/**
 * The in-app notice that a computer finished setup or could not be set up.
 * The buyer may have closed the setup dialog minutes ago, so it stays up a
 * minute and `open` takes them back to setup. The setup dialog's own "ready"
 * notice and the notification's are the same notice, so a second one for the
 * same computer and outcome is not shown while the first is up. "Ready" is
 * only for setup the user left unfinished: it is not shown while the
 * computer's buy dialog is open or once its setup is complete.
 */
export function showComputerSetupNotice(
  notice: ComputerSetupNotice,
  open: () => void
) {
  const key = `${notice.computerId}:${notice.outcome.kind}`;
  if (showing.has(key)) return;
  if (
    notice.outcome.kind === 'ready' &&
    (inDialog.has(notice.computerId) || setupComplete(notice.computerId))
  )
    return;
  // The dialog it opens takes over; the notice goes.
  const openSetup = () => {
    const id = showing.get(key);
    if (id !== undefined) toast.dismiss(id);
    open();
  };
  const common = {
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
