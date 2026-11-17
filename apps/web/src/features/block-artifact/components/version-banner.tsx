import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';

/** Shown while an older version is open; editors can restore it. */
export function VersionBanner(props: {
  number: number;
  canRestore: boolean;
  restoring: boolean;
  onLatest: () => void;
  onRestore: () => void;
}) {
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted bg-panel px-3 py-2 text-sm">
      <span class="min-w-0 flex-1 text-ink-muted">
        {t('artifacts.viewingVersion', { number: props.number })}
      </span>
      <Button variant="ghost" size="sm" onClick={props.onLatest}>
        {t('artifacts.backToLatest')}
      </Button>
      <Show when={props.canRestore}>
        <Button
          variant="primary"
          size="sm"
          loading={props.restoring}
          onClick={props.onRestore}
        >
          {t('artifacts.restore')}
        </Button>
      </Show>
    </div>
  );
}
