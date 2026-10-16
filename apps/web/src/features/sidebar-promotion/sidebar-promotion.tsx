import { useUserId } from '@core/context/user';
import { usePromptDismissalsQuery } from '@queries/prompt-dismissals';
import { cn } from '@ui';
import { type JSX, Show, untrack } from 'solid-js';
import { z } from 'zod';
import type { PromotionLogo } from './components/logo-stack';
import { type PromoAction, PromoCard } from './components/promo-card';
import { allOf, type Verdict } from './core/verdict';
import { createLastKnown } from './primitives/last-known';
import {
  hidePromotion,
  isPromotionHiddenLocally,
} from './primitives/promotion';

export type { PromotionLogo } from './components/logo-stack';
export type { PromoAction } from './components/promo-card';
export { allOf, flagVerdict, type Verdict } from './core/verdict';

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
  const userId = useUserId();
  const dismissals = usePromptDismissalsQuery();
  // An unreachable server falls back to what this browser remembers.
  const dismissed = (): Verdict => {
    if (isPromotionHiddenLocally(userId(), props.id)) return true;
    if (dismissals.isError) return false;
    if (!dismissals.isSuccess) return undefined;
    return dismissals.data.dismissed.includes(props.id);
  };
  const shown = createLastKnown(
    `shown:${untrack(() => props.id)}`,
    untrack(userId),
    () =>
      allOf(
        props.applies,
        dismissed() === undefined ? undefined : !dismissed()
      ),
    z.boolean()
  );
  return (
    <Show when={shown()}>
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
          onDismiss={() => hidePromotion(userId(), props.id)}
        />
      </div>
    </Show>
  );
}
