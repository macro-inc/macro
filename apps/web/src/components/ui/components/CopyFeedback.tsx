import CheckCircle from '@icon/system/fill/check-circle-fill.svg';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

const TRANSITION_MS = 160;
const SUCCESS_MS = 1400;

/** Shared copy animation and pending-activation guard for buttons and menu items. */
export function createCopyFeedback(target: () => HTMLElement | undefined) {
  const [feedback, setFeedback] = createSignal<JSX.CSSProperties>();
  let check: SVGSVGElement | undefined;
  let animations: Animation[] = [];
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let disposed = false;

  function clearFeedback() {
    clearTimeout(resetTimer);
    clearTimeout(exitTimer);
    for (const animation of animations) animation.cancel();
    animations = [];
    setFeedback(undefined);
    check = undefined;
  }

  onCleanup(() => {
    disposed = true;
    clearFeedback();
  });

  function animate(element: SVGSVGElement, entering: boolean) {
    const frames = [
      { opacity: 0, scale: '0.75', transformOrigin: 'center' },
      { opacity: 1, scale: '1', transformOrigin: 'center' },
    ];
    animations.push(
      element.animate(entering ? frames : frames.toReversed(), {
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 0
          : TRANSITION_MS,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      })
    );
  }

  function showSuccess() {
    clearFeedback();
    const container = target();
    const icon = container?.querySelector<SVGSVGElement>('svg');
    if (!container || !icon) return;
    const iconRect = icon.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    animate(icon, false);
    setFeedback({
      left: `${iconRect.left - containerRect.left - container.clientLeft}px`,
      top: `${iconRect.top - containerRect.top - container.clientTop}px`,
      width: `${iconRect.width}px`,
      height: `${iconRect.height}px`,
    });
    resetTimer = setTimeout(() => {
      for (const animation of animations) animation.cancel();
      animations = [];
      animate(icon, true);
      if (check) animate(check, false);
      exitTimer = setTimeout(clearFeedback, TRANSITION_MS);
    }, SUCCESS_MS);
  }

  async function activate(action: () => unknown) {
    if (pending || disposed) return;
    pending = true;
    clearFeedback();
    try {
      const result = await action();
      if (!disposed && result !== false) showSuccess();
    } catch {
      // The caller owns error reporting; rejected copies never show success.
    } finally {
      pending = false;
    }
  }

  function FeedbackIcon(props: { style: JSX.CSSProperties }) {
    let icon!: SVGSVGElement;
    onMount(() => {
      check = icon;
      animate(icon, true);
    });
    return (
      <CheckCircle
        ref={icon}
        data-copy-feedback
        aria-hidden="true"
        class="pointer-events-none absolute text-success opacity-0"
        style={props.style}
      />
    );
  }

  function CopyFeedback() {
    return (
      <Show when={feedback()}>
        {(style) => <FeedbackIcon style={style()} />}
      </Show>
    );
  }

  return { activate, CopyFeedback };
}
