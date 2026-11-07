import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { Show } from 'solid-js';

/** A load that failed in place, with Retry when trying again can help. */
export function InlineFailure(props: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
}) {
  return (
    <div class="flex items-center gap-2 text-xs text-failure" role="alert">
      {props.message}
      <Show when={props.retryable}>
        <Button
          type="button"
          variant="link"
          size="xs"
          onClick={() => props.onRetry()}
        >
          {t('sequences.retry')}
        </Button>
      </Show>
    </div>
  );
}
