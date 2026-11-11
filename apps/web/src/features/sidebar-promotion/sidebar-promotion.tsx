import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { PromotionLogo } from './components/logo-stack';
import { type PromoAction, PromoCard } from './components/promo-card';
import type { Verdict } from './core/verdict';
import { createPromotionVisibility } from './primitives/promotion-visibility';

export type { PromotionLogo } from './components/logo-stack';
export type { PromoAction } from './components/promo-card';
export { allOf, flagVerdict, type Verdict } from './core/verdict';
export { createPromotionVisibility } from './primitives/promotion-visibility';

/**
 * A view sidebar's dismissible prompt card. Dismissal is stored on the
 * server under `id`, so it holds on every device; hosts decide whether the
 * card applies and supply the actions.
 *
 * Every remount renders at once: while the host's inputs or the server's
 * dismissals load, the card keeps what this browser last decided for it, so
 * a shown card never pops in late and a hidden one never flashes.
 */
export function SidebarPromotion(props: {
  id: string;
  /**
   * Whether the card applies (rollout flags on, goal not yet met):
   * `undefined` while the host's flags or queries load.
   */
  applies: Verdict;
  logos: readonly PromotionLogo[];
  headline: string;
  pitch: string;
  action: PromoAction;
  secondaryAction?: PromoAction;
  /** Defaults to "Dismiss <action label>". */
  dismissLabel?: string;
  class?: string;
}): JSX.Element {
  const visibility = createPromotionVisibility(
    () => props.id,
    () => props.applies
  );
  return (
    <Show when={visibility.shown()}>
      <div class={cn('shrink-0', props.class)}>
        <PromoCard
          logos={props.logos}
          headline={props.headline}
          pitch={props.pitch}
          action={props.action}
          secondaryAction={props.secondaryAction}
          dismissLabel={
            props.dismissLabel ?? `Dismiss ${props.action.label.toLowerCase()}`
          }
          onDismiss={visibility.dismiss}
        />
      </div>
    </Show>
  );
}
