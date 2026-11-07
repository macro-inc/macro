import { RequestAccessView } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';

/** Server-supported levels cap requests on dedicated agent computers at View. */
export function RuntimeAccessAction(props: {
  harnessId: string;
  controlOnly?: boolean;
}) {
  const source = createSharingSource(
    () => shareEntity('harness', props.harnessId),
    () => true
  );
  return (
    <Show
      when={
        !props.controlOnly || source.state()?.supportedLevels.includes('edit')
      }
    >
      <div
        class="flex min-w-0 flex-col gap-2"
        classList={{
          'shrink-0': props.controlOnly,
          'border-b': props.controlOnly,
          'border-edge-muted': props.controlOnly,
          'p-3': props.controlOnly,
        }}
      >
        <Show when={props.controlOnly}>
          <p class="text-xs text-ink-muted">
            {t('runtimeSharing.requestControlHint')}
          </p>
        </Show>
        <Show when={source.loading()}>
          <p role="status" class="text-xs text-ink-muted">
            {t('runtimeSharing.loadingAccess')}
          </p>
        </Show>
        <RequestAccessView
          source={source}
          allowedLevels={props.controlOnly ? ['edit'] : ['view', 'edit']}
        />
        <Show when={source.error()}>
          <p role="alert" class="text-xs text-failure-ink">
            {source.error()}
          </p>
        </Show>
      </div>
    </Show>
  );
}
