import { isTouchDevice } from '@core/mobile/isTouchDevice';
import XIcon from '@phosphor/x.svg';
import { Button, ComposerSurface, cn } from '@ui';
import { Show } from 'solid-js';
import { LogoStack, type PromotionLogo } from './logo-stack';

export type PromoAction = {
  label: string;
  onClick(trigger: HTMLButtonElement): void;
};

/**
 * A dismissible sidebar prompt: logos, a headline, a pitch, and actions.
 * Desktop shares the email message card's surface (rounding, soft shadow,
 * dark rim); touch keeps a plain bordered card.
 */
export function PromoCard(props: {
  logos: readonly PromotionLogo[];
  headline: string;
  pitch: string;
  action: PromoAction;
  /** Shown beside the main action, splitting the row. */
  secondaryAction?: PromoAction;
  /** Accessible name for the close button. */
  dismissLabel: string;
  onDismiss(): void;
}) {
  return (
    <ComposerSurface
      as="div"
      role="region"
      class={cn(
        'w-full p-4',
        isTouchDevice() && 'rounded-xl border border-edge-muted bg-control'
      )}
      aria-label={props.headline}
    >
      {/* Same-height row: the logos and the close glyph share one inset. */}
      <div class="flex items-start justify-between gap-2">
        <LogoStack
          logos={props.logos}
          class={
            isTouchDevice()
              ? undefined
              : '[--logo-stack-separator:var(--color-composer)]'
          }
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={props.dismissLabel}
          onClick={() => props.onDismiss()}
        >
          <XIcon class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <h2 class="mt-2.5 text-xs font-medium text-ink">{props.headline}</h2>
      <p class="mt-1 text-[11px] leading-4 text-ink-muted">{props.pitch}</p>
      <div class="mt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          class="min-w-0 flex-1"
          onClick={(event) => props.action.onClick(event.currentTarget)}
        >
          {props.action.label}
        </Button>
        <Show when={props.secondaryAction}>
          {(secondary) => (
            <Button
              variant="outline"
              size="sm"
              class="min-w-0 flex-1"
              onClick={(event) => secondary().onClick(event.currentTarget)}
            >
              {secondary().label}
            </Button>
          )}
        </Show>
      </div>
    </ComposerSurface>
  );
}
