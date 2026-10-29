import { useUserId } from '@core/context/user';
import { usePromptDismissalsQuery } from '@queries/prompt-dismissals';
import { type Accessor, untrack } from 'solid-js';
import { z } from 'zod';
import { allOf, type Verdict } from '../core/verdict';
import { createLastKnown } from './last-known';
import { hidePromotion, isPromotionHiddenLocally } from './promotion';

/**
 * Whether a dismissible sidebar card shows, and its dismiss action.
 * Dismissal is stored on the server under `id`, so it holds on every device.
 *
 * Every remount answers at once: while `applies` or the server's dismissals
 * load, it keeps what this browser last decided for the card, so a shown
 * card never pops in late and a hidden one never flashes.
 */
export function createPromotionVisibility(
  id: Accessor<string>,
  /** `undefined` while the host's flags or queries load. */
  applies: Accessor<Verdict>
): { shown: Accessor<boolean | undefined>; dismiss: () => void } {
  const userId = useUserId();
  const dismissals = usePromptDismissalsQuery();
  const dismissed = (): Verdict => {
    if (isPromotionHiddenLocally(userId(), id())) return true;
    if (dismissals.isPending) return undefined;
    // A failed refetch keeps the last list it loaded.
    if (dismissals.data) return dismissals.data.dismissed.includes(id());
    // With no list at all, fall back to what this browser remembers.
    return false;
  };
  const shown = createLastKnown(
    `shown:${untrack(id)}`,
    untrack(userId),
    () =>
      allOf(applies(), dismissed() === undefined ? undefined : !dismissed()),
    z.boolean()
  );
  return { shown, dismiss: () => hidePromotion(userId(), id()) };
}
