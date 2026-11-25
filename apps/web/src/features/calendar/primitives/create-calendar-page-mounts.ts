import type { SnapPagerController } from '@ui/components/SnapPager/SnapPager';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/** Paint the active page first, then prepare every reachable stable slot. */
export function createCalendarPageMounts(
  pager: Pick<SnapPagerController, 'activePage' | 'pages' | 'phase'>
) {
  const [mounted, setMounted] = createSignal<readonly number[]>([
    pager.activePage(),
  ]);
  const prepareRing = () => {
    setMounted(pager.pages().map((page) => page.key));
  };
  // A cancellable idle queue can starve forever under consecutive swipes.
  // Slots never unmount or move in the DOM; prepare their contents after the
  // first paint, or before movement when the first gesture starts sooner.
  const frame = requestAnimationFrame(prepareRing);
  onCleanup(() => cancelAnimationFrame(frame));
  createEffect(
    on(pager.phase, (phase) => {
      if (phase !== 'idle') prepareRing();
    })
  );
  return mounted;
}
