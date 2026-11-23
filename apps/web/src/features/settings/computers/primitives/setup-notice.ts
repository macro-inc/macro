import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { queryAccountSession } from '@queries/auth/account-scope';
import { fetchComputers } from '@queries/computers/computers';
import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';
import { match } from 'ts-pattern';

/** What a computer setup notification carries. */
export type ComputerSetupNotice = Extract<
  NotifEvent,
  { tag: 'computer_setup' }
>['content'];

/** The notices on screen, one per computer and outcome. */
const showing = new Map<string, number>();

/** How many open buy dialogs show each computer's progress themselves. */
const inDialog = new Map<string, number>();

/**
 * Keep the "ready, finish setup" notice away while a buy dialog for
 * `computerId` is open, and take down one already up. Returns the release.
 */
export function holdSetupNotices(computerId: string): () => void {
  inDialog.set(computerId, (inDialog.get(computerId) ?? 0) + 1);
  const id = showing.get(`${computerId}:ready`);
  if (id !== undefined) toast.dismiss(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holds = (inDialog.get(computerId) ?? 1) - 1;
    if (holds > 0) inDialog.set(computerId, holds);
    else inDialog.delete(computerId);
  };
}

/**
 * Whether the team's list says `computerId` finished its setup, read fresh:
 * the notification just invalidated a cached row that may predate it.
 * Unreadable counts as unfinished: the notice still shows.
 */
async function setupComplete(computerId: string): Promise<boolean> {
  try {
    const computers = await fetchComputers();
    return !!computers.find((computer) => computer.id === computerId)
      ?.setupCompletedAt;
  } catch {
    return false;
  }
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
export async function showComputerSetupNotice(
  notice: ComputerSetupNotice,
  open: () => void
) {
  const key = `${notice.computerId}:${notice.outcome.kind}`;
  if (notice.outcome.kind === 'ready') {
    if (inDialog.has(notice.computerId)) return;
    const session = queryAccountSession();
    const complete = await setupComplete(notice.computerId);
    // Another login during the read: the notice is the old account's.
    if (queryAccountSession() !== session) return;
    if (complete) return;
    // A dialog may have opened while the list was read.
    if (inDialog.has(notice.computerId)) return;
  }
  if (showing.has(key)) return;
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
