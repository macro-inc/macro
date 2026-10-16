import { Button } from '@ui';
import { Show } from 'solid-js';
import { AccessLevelSelect } from '../components/AccessLevelSelect';
import type { SharingSource } from '../context/contracts';
import type { AccessLevel } from '../core/types';
import { createRequestComposer } from '../primitives/request-composer';

export function RequestAccessView(props: {
  source: SharingSource;
  allowedLevels: readonly AccessLevel[];
}) {
  const composer = createRequestComposer(
    props.source,
    () => props.allowedLevels
  );
  const send = async () => {
    try {
      await composer.send();
    } catch {
      /* Source exposes the failed write inline. */
    }
  };
  const cancel = async () => {
    try {
      await composer.cancel();
    } catch {
      /* Source exposes the failed write inline. */
    }
  };
  return (
    <Show when={composer.visible()}>
      <div
        class="flex flex-wrap items-center justify-between gap-2"
        data-access-request-row
      >
        <div class="flex flex-col gap-1">
          <span class="font-medium">
            {composer.pending() ? 'Access requested' : 'Request access'}
          </span>
          <Show when={composer.coolingDown()}>
            <span class="text-xs text-ink-muted">
              {props.source.state()?.mine?.status === 'denied'
                ? 'Request denied. You can request again after '
                : 'You can send another request after '}
              {new Date(composer.retryAfter()!).toLocaleString()}.
            </span>
          </Show>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink-muted">Access level</span>
            <AccessLevelSelect
              label="Requested access level"
              value={composer.level()}
              levels={composer.levels()}
              onChange={composer.setSelected}
              disabled={
                props.source.busy() ||
                composer.coolingDown() ||
                composer.levels().length === 0
              }
            />
          </div>
          <Button
            variant="cta"
            size="sm"
            disabled={
              props.source.busy() ||
              composer.coolingDown() ||
              composer.unchanged() ||
              composer.levels().length === 0
            }
            onClick={() => void send()}
          >
            {composer.pending()
              ? composer.unchanged()
                ? 'Request sent'
                : 'Change request'
              : 'Request access'}
          </Button>
          <Show when={composer.pending()}>
            <Button
              variant="ghost"
              size="sm"
              disabled={props.source.busy()}
              onClick={() => void cancel()}
            >
              Cancel request
            </Button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
