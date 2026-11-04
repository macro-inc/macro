import { shareEntity } from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { Button } from '@ui';
import { Show } from 'solid-js';

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
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      toast.failure(t('runtimeSharing.writeFailed'));
    }
  };
  return (
    <Show
      when={pending()}
      fallback={
        <Button
          variant="secondary"
          size="sm"
          disabled={source.busy() || coolingDown() || !source.state()}
          onClick={() =>
            run(() => source.submit('edit', mine()?.revision ?? undefined))
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
        aria-label={t('runtimeSharing.cancelRequest')}
        onClick={() => {
          const revision = mine()?.revision;
          if (revision !== undefined) run(() => source.cancel(revision));
        }}
      >
        {t('runtimeSharing.requested')}
      </Button>
    </Show>
  );
}
