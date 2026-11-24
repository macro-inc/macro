import { t } from '@app/lib/i18n';
import MinusIcon from '@icon/system/regular/minus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';

/** The zoom level with − / + and Fit, for people without a pinch. */
export function ZoomControl(props: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Sit at the top instead, away from a finger near the bottom. */
  top: boolean;
}) {
  return (
    <div
      class={cn(
        'menu-surface absolute right-2 z-10 flex items-center gap-1 rounded-full p-0.5',
        props.top ? 'top-2' : 'bottom-2'
      )}
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('agentScreen.zoomOut')}
        onClick={() => props.onZoomOut()}
      >
        <MinusIcon class="size-4" />
      </Button>
      <span class="min-w-10 text-center text-xs tabular-nums text-ink-muted">
        {t('agentScreen.zoomPercent', {
          percent: Math.round(props.zoom * 100),
        })}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('agentScreen.zoomIn')}
        onClick={() => props.onZoomIn()}
      >
        <PlusIcon class="size-4" />
      </Button>
      <Show when={props.zoom > 1.01}>
        <Button size="sm" variant="ghost" onClick={() => props.onFit()}>
          {t('agentScreen.fit')}
        </Button>
      </Show>
    </div>
  );
}
