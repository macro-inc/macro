import { createAnimationGroup } from '@app/lib/utils/create-animation-group';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createSignal, onCleanup, onMount } from 'solid-js';

/** Keep the card in flow while its message or inline reply changes height. */
export function createMessageResizeMotion() {
  let card: HTMLDivElement | undefined;
  const [content, setContent] = createSignal<HTMLDivElement>();
  const motion = createAnimationGroup();
  let previousHeight = 0;
  let previousWidth = 0;

  onMount(() => {
    previousHeight = content()?.getBoundingClientRect().height ?? 0;
    previousWidth = content()?.getBoundingClientRect().width ?? 0;
  });
  onCleanup(motion.cancel);

  createResizeObserver(content, ({ height, width }) => {
    if (!card) return;
    const fromHeight = previousHeight;
    const widthChanged = Math.abs(width - previousWidth) > 1;
    previousHeight = height;
    previousWidth = width;
    if (widthChanged) {
      motion.cancel();
      return;
    }
    if (Math.abs(height - fromHeight) < 1) return;

    const style = getComputedStyle(card);
    const chrome =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom) +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    const from = motion.running()
      ? card.getBoundingClientRect().height
      : fromHeight + chrome;
    motion.cancel();

    if (
      !card.animate ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    motion.start(
      [
        {
          target: card,
          keyframes: [
            { height: `${from}px`, overflow: 'clip', boxSizing: 'border-box' },
            {
              height: `${height + chrome}px`,
              overflow: 'clip',
              boxSizing: 'border-box',
            },
          ],
        },
      ],
      { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      () => {}
    );
  });

  return {
    setCard: (element: HTMLDivElement) => {
      card = element;
    },
    setContent,
  };
}
