import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

type ScrollPhase =
  | 'waiting-for-layout'
  | 'waiting-for-element'
  | 'ready'
  | 'disposed';
type ScrollEvent =
  | 'layout'
  | 'navigate'
  | 'user-scroll'
  | 'timeout'
  | 'dispose';

/** Owns initial positioning and its cancellation; geometry stays in TanStack. */
export function createScrollLifecycle(options: {
  hasLayout: () => boolean;
  waitForElement: boolean;
  positionInitial: () => void;
  positionFallback: () => void;
  onReady: () => void;
}) {
  const [phase, setPhase] = createSignal<ScrollPhase>('waiting-for-layout');
  let fallback: ReturnType<typeof setTimeout> | undefined;

  const transition = (next: ScrollPhase) => {
    clearTimeout(fallback);
    fallback = undefined;
    setPhase(next);
  };

  const send = (event: ScrollEvent): void => {
    if (phase() === 'disposed') return;
    match(event)
      .with('layout', () => {
        if (phase() !== 'waiting-for-layout' || !options.hasLayout()) return;
        if (options.waitForElement) {
          transition('waiting-for-element');
          fallback = setTimeout(() => send('timeout'), 1500);
        } else {
          transition('ready');
          options.positionInitial();
        }
        options.onReady();
      })
      .with('navigate', 'user-scroll', () => {
        if (phase() === 'waiting-for-element') transition('ready');
      })
      .with('timeout', () => {
        if (phase() !== 'waiting-for-element') return;
        transition('ready');
        options.positionFallback();
      })
      .with('dispose', () => transition('disposed'))
      .exhaustive();
  };

  return {
    send,
    isReady: () => phase() === 'ready' || phase() === 'waiting-for-element',
    isDisposed: () => phase() === 'disposed',
  };
}
