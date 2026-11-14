import { t } from '@app/lib/i18n';
import WarningIcon from '@phosphor/warning.svg';
import WarningOctagonIcon from '@phosphor/warning-octagon.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { type BannerStatus, STATUS_LABELS } from '../core/status';

/**
 * The full-width bar across the top of the app while Macro is degraded or
 * down. On touch devices it sits under the status bar, so it pads itself by
 * the top safe area. With `onDismiss`, it shows a close button on the right.
 */
export function StatusBanner(
  props: Pick<BannerStatus, 'level' | 'message'> & {
    class?: string;
    onDismiss?: () => void;
  }
) {
  const isOutage = () => props.level === 'major_outage';
  return (
    <div
      role="status"
      class={cn(
        'w-full shrink-0 border-b px-4 py-1.5 text-sm touch:pt-[calc(var(--safe-top,0px)+0.375rem)]',
        isOutage()
          ? 'border-failure/20 bg-failure-bg text-failure-ink'
          : 'border-alert/20 bg-alert-bg text-alert-ink',
        props.class
      )}
    >
      <div class="flex items-center gap-2">
        <div class="mx-auto flex min-w-0 max-w-5xl flex-1 items-center justify-center gap-2">
          <Show
            when={isOutage()}
            fallback={<WarningIcon class="size-4 shrink-0" />}
          >
            <WarningOctagonIcon class="size-4 shrink-0" />
          </Show>
          <p class="min-w-0 line-clamp-2" title={props.message}>
            <span class="font-semibold">{STATUS_LABELS[props.level]}</span>
            <span class="mx-1.5 opacity-60">·</span>
            {props.message}
          </p>
        </div>
        <Show when={props.onDismiss}>
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0"
            aria-label={t('common.dismiss')}
            onClick={() => props.onDismiss?.()}
          >
            <XIcon class="size-4" aria-hidden="true" />
          </Button>
        </Show>
      </div>
    </div>
  );
}
