import { createSignal } from 'solid-js';

const ROW_DURATION = 240;
const BATCH_DURATION = 180;
const REPLACEMENT_DURATION = 300;
const ROW_STAGGER = 55;
const BATCH_STAGGER = 12;

function rowDelay(index: number, batch: boolean) {
  return batch ? Math.min(index * BATCH_STAGGER, 24) : index * ROW_STAGGER;
}

function animateEnter(
  element: Element,
  done: () => void,
  delay: number,
  duration: number,
  overlap: boolean
) {
  if (
    !(element instanceof HTMLElement) ||
    typeof element.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    done();
    return;
  }
  const size = element.scrollHeight;
  const height = `${size}px`;
  const frames: Keyframe[] = overlap
    ? [
        { height: '0px', opacity: 0, transform: 'translateX(-100%)', offset: 0 },
        {
          height: `${size * 0.75}px`,
          opacity: 0,
          transform: 'translateX(-100%)',
          offset: 0.45,
        },
        { height, opacity: 0.3, transform: 'translateX(-70%)', offset: 0.6 },
        { height, opacity: 1, transform: 'translateX(0)', offset: 1 },
      ]
    : [
        { height: '0px', opacity: 0, transform: 'translateX(-100%)' },
        { height, opacity: 1, transform: 'translateX(0)' },
      ];
  const animation = element.animate(frames, {
    delay,
    duration,
    easing: 'ease-out',
    fill: 'both',
  });
  animation.onfinish = done;
}

function animateExit(
  element: Element,
  done: () => void,
  delay: number,
  duration: number,
  direction: 'left' | 'right'
) {
  if (
    !(element instanceof HTMLElement) ||
    typeof element.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    done();
    return;
  }
  const size = element.getBoundingClientRect().height;
  const destination =
    direction === 'right' ? 'translateX(100%)' : 'translateX(-100%)';
  const animation = element.animate(
    [
      {
        height: `${size}px`,
        opacity: 1,
        transform: 'translateX(0)',
        offset: 0,
      },
      {
        height: `${size * 0.4}px`,
        opacity: 0,
        transform: destination,
        offset: 0.6,
      },
      { height: '0px', opacity: 0, transform: destination, offset: 1 },
    ],
    { delay, duration, easing: 'ease-in-out', fill: 'both' }
  );
  animation.onfinish = done;
}

/** TransitionGroup hooks for sliding list rows, with a count for delayed empty states. */
export function createSlidingListTransition() {
  const [exitingRows, setExitingRows] = createSignal(0);
  let nextExitIndex = 0;
  let nextEnterIndex = 0;
  let enteringCount = 0;

  return {
    exitingRows,
    transitionProps: {
      moveClass: 'transition-transform duration-[240ms] ease-out',
      onBeforeEnter: (element: Element) => {
        if (enteringCount === 0) {
          // Reset after this update's enter and exit callbacks have run.
          queueMicrotask(() => queueMicrotask(() => (enteringCount = 0)));
        }
        enteringCount++;
        if (!(element instanceof HTMLElement)) return;
        element.style.height = '0px';
        element.style.overflow = 'hidden';
        element.style.opacity = '0';
        element.style.transform = 'translateX(-100%)';
        element.inert = true;
      },
      onEnter: (element: Element, done: () => void) => {
        const index = nextEnterIndex++;
        if (index === 0) queueMicrotask(() => (nextEnterIndex = 0));
        const departing = exitingRows();
        const batch = departing >= 3 || enteringCount >= 3;
        const overlap = batch && departing > 0;
        // Grow batch replacements while old rows shrink, then reveal them.
        const start = departing && !batch
          ? 150 + (departing - 1) * ROW_STAGGER
          : 0;
        let duration = ROW_DURATION;
        if (overlap) {
          duration = REPLACEMENT_DURATION;
        } else if (batch) {
          duration = BATCH_DURATION;
        }
        animateEnter(
          element,
          done,
          start + rowDelay(index, batch),
          duration,
          overlap
        );
      },
      onAfterEnter: (element: Element) => {
        if (
          !(element instanceof HTMLElement) ||
          element.getAttribute('aria-hidden') === 'true'
        ) return;
        element.style.height = '';
        element.style.overflow = '';
        element.style.opacity = '';
        element.style.transform = '';
        element.inert = false;
      },
      onBeforeExit: (element: Element) => {
        element.setAttribute('aria-hidden', 'true');
        if (element instanceof HTMLElement) {
          element.style.opacity = '';
          element.style.transform = '';
          element.inert = true;
        }
        setExitingRows((count) => count + 1);
      },
      onExit: (element: Element, done: () => void) => {
        const index = nextExitIndex++;
        if (index === 0) queueMicrotask(() => (nextExitIndex = 0));
        const replaced = enteringCount > 0;
        // All removals are known after the current update finishes.
        queueMicrotask(() => {
          const batch = exitingRows() >= 3 || enteringCount >= 3;
          animateExit(
            element,
            done,
            rowDelay(index, batch),
            batch ? BATCH_DURATION : ROW_DURATION,
            replaced ? 'right' : 'left'
          );
        });
      },
      onAfterExit: () => setExitingRows((count) => count - 1),
    },
  };
}
