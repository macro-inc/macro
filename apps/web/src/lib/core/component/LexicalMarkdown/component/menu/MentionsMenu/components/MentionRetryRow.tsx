import { t } from '@app/lib/i18n';
import { Button } from '@ui';

/** A failed read's message and Retry, which leave focus in the editor. */
export function MentionRetryRow(props: {
  message: string;
  onRetry: () => void;
}) {
  const keepEditorFocus = (event: Event) => event.preventDefault();
  return (
    <div
      role="alert"
      class="mx-1.5 flex items-center justify-between gap-2 p-1.5 text-xs text-ink-muted"
      onPointerDown={keepEditorFocus}
      onMouseDown={keepEditorFocus}
    >
      <span>{props.message}</span>
      <Button variant="ghost" size="sm" onClick={props.onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
