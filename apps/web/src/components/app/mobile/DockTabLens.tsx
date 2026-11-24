import { debounce } from '@core/util/debounce';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { lensIndexAt, lensOffset } from './dock-lens-geometry';

/** Quiet time after the last scroll event before a drag counts as settled. */
const SETTLE_DELAY_MS = 160;

/**
 * The dock's tab bar as a scroll controller (after rida.dev's "Bypassing the
 * iOS Safari 60 fps limit"). Safari caps touch events, requestAnimationFrame
 * and main-thread rendering at 60 Hz, but scrolling runs on the compositor at
 * the display's full rate. So the bar is an invisible horizontal scroller:
 * its buttons stay put (`position: sticky`) and the lens is scrolled content,
 * so it follows the finger at 120 Hz with no script in the loop. Each tab is
 * a snap point, so a released lens glides to the nearest tab with native
 * momentum and rubber-bands past the ends.
 *
 * A tap is the button's own click. A drag that ends on another tab presses
 * that tab's button. The lens shows only while a finger is on the bar, so the
 * resting dock keeps its ink-only selection.
 */
export function DockTabLens(props: {
  /** The selected button's index among the bar's buttons, or -1. */
  activeIndex: number;
  children: JSX.Element;
}) {
  const [row, setRow] = createSignal<HTMLDivElement>();
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const rowSize = createElementSize(row);
  const [centers, setCenters] = createSignal<number[]>([]);
  const [lensShown, setLensShown] = createSignal(false);
  const span = () => {
    const all = centers();
    return all.length > 1 ? all[all.length - 1] - all[0] : 0;
  };
  const buttons = () =>
    [...(row()?.children ?? [])].filter(
      (child): child is HTMLButtonElement => child instanceof HTMLButtonElement
    );
  const measure = () =>
    setCenters(
      buttons().map((button) => button.offsetLeft + button.offsetWidth / 2)
    );
  const restOn = (index: number) => {
    const element = scroller();
    if (!element || index < 0 || index >= centers().length) return;
    element.scrollLeft = lensOffset(centers(), index);
  };

  createEffect(on(() => [rowSize.width, rowSize.height], measure));
  // Rest the (hidden) lens on the selected tab, so a drag starts from there.
  createEffect(
    on([() => props.activeIndex, centers], ([index]) => {
      if (!lensShown()) restOn(index);
    })
  );

  onMount(() => {
    const element = scroller();
    const bar = row();
    if (!element || !bar) return;
    const listening = new AbortController();
    onCleanup(() => listening.abort());
    const { signal } = listening;
    const changes = new MutationObserver(measure);
    changes.observe(bar, { childList: true });
    onCleanup(() => changes.disconnect());

    let touching = false;
    let moved = false;
    let startOffset = 0;
    const settle = () => {
      if (touching) return;
      const index = lensIndexAt(centers(), element.scrollLeft);
      if (moved && index !== props.activeIndex) buttons()[index]?.click();
      moved = false;
      setLensShown(false);
    };
    const settleSoon = debounce(settle, SETTLE_DELAY_MS);
    element.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.touches[0];
        if (!touch || event.touches.length > 1) return;
        touching = true;
        moved = false;
        settleSoon.clear();
        // The lens lifts under the finger, then follows it.
        const x = touch.clientX - bar.getBoundingClientRect().left;
        const all = centers();
        const nearest = all.reduce(
          (best, center, index) =>
            Math.abs(center - x) < Math.abs(all[best] - x) ? index : best,
          0
        );
        restOn(nearest);
        startOffset = lensOffset(all, nearest);
        setLensShown(true);
      },
      { passive: true, signal }
    );
    element.addEventListener(
      'scroll',
      () => {
        if (Math.abs(element.scrollLeft - startOffset) > 2) moved = true;
        if (!touching) settleSoon();
      },
      { passive: true, signal }
    );
    for (const type of ['touchend', 'touchcancel'])
      element.addEventListener(
        type,
        () => {
          touching = false;
          settleSoon();
        },
        { passive: true, signal }
      );
    element.addEventListener(
      'scrollend',
      () => {
        settleSoon.clear();
        settle();
      },
      { signal }
    );
  });

  return (
    <div
      ref={setScroller}
      data-dock-lens-controller
      class="absolute inset-0 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-full touch-pan-x"
    >
      <div
        class="relative h-full"
        style={{ width: `calc(100% + ${span()}px)` }}
      >
        {/* One snap point per tab: scrolling left by the distance between
            the first tab and another puts the lens on that tab. */}
        <For each={centers()}>
          {(_, index) => (
            <div
              aria-hidden="true"
              class="pointer-events-none absolute top-0 h-px w-px snap-start"
              style={{ left: `${lensOffset(centers(), index())}px` }}
            />
          )}
        </For>
        <div
          aria-hidden="true"
          data-dock-lens
          data-shown={lensShown() ? '' : undefined}
          class={cn(
            'pointer-events-none absolute top-0 size-(--mobile-chrome-button-size) -translate-x-1/2 rounded-full bg-ink/10 transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none',
            lensShown() ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
          )}
          style={{ left: `${span() + (centers()[0] ?? 0)}px` }}
        />
        <div
          ref={setRow}
          class="sticky left-0 flex h-full items-center justify-between"
          style={{ width: `calc(100% - ${span()}px)` }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
