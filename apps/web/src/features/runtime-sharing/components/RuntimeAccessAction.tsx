import { shareEntity } from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Ask a runtime's owner for access, or take back a request still pending. */
export function RuntimeAccessAction(props: { harnessId: string }) {
  const source = createSharingSource(
    () => shareEntity('harness', props.harnessId),
    () => true
  );
  const mine = () => source.state()?.mine;
  const pending = () => mine()?.status === 'pending';
  const coolingDown = () => {
    const until = mine()?.retryAfter;
    return !!until && new Date(until).getTime() > Date.now();
  };
  // Set before the request goes out, so the button shows its spinner at once
  // and a second click cannot send the change twice.
  const [running, setRunning] = createSignal(false);
  const run = async (
    action: () => Promise<unknown>,
    failed: string,
    succeeded?: string
  ) => {
    if (running()) return;
    setRunning(true);
    try {
      await action();
    } catch {
      toast.failure(failed);
      return;
    } finally {
      setRunning(false);
    }
    if (succeeded) toast.success(succeeded);
  };
  return (
    <Show
      when={pending()}
      fallback={
        <Button
          variant="secondary"
          size="sm"
          disabled={source.busy() || coolingDown() || !source.state()}
          loading={running()}
          onClick={() =>
            fireAndForget(
              run(
                () => source.submit('edit', mine()?.revision ?? undefined),
                t('runtimeSharing.requestFailed'),
                t('runtimeSharing.requestSent')
              ),
              'runtime-sharing'
            )
          }
        >
          {mine()?.status === 'denied' && coolingDown()
            ? t('runtimeSharing.requestDenied')
            : t('runtimeSharing.requestAccess')}
        </Button>
      }
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={source.busy()}
        loading={running()}
        aria-label={t('runtimeSharing.cancelRequest')}
        onClick={() => {
          const revision = mine()?.revision;
          if (revision !== undefined)
            fireAndForget(
              run(
                () => source.cancel(revision),
                t('runtimeSharing.writeFailed')
              ),
              'runtime-sharing'
            );
        }}
      >
        {t('runtimeSharing.requested')}
      </Button>
    </Show>
  );
}
