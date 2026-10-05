import CheckCircle from '@phosphor-fill/check-circle-fill.svg';
import { mergeRefs } from '@solid-primitives/refs';
import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from 'solid-js';
import { Button, type ButtonProps } from './Button';

export type CopyButtonProps = ButtonProps;

const TRANSITION_MS = 160;
const SUCCESS_MS = 1400;

/**
 * Button with copy-success feedback, using the same props and children.
 * The first SVG fades to a check-circle without changing its layout or size.
 *
 * @do Return the clipboard promise from onClick so feedback waits for success.
 * @do Return false (or reject) when copying fails; report errors in the handler.
 * @dont Discard the promise with `void` inside onClick.
 */
export function CopyButton(props: CopyButtonProps) {
  const [local, rest] = splitProps(props, ['onClick', 'children', 'ref']);
  const [feedback, setFeedback] = createSignal<JSX.CSSProperties>();
  let button!: HTMLButtonElement;
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
    const icon = button.querySelector<SVGSVGElement>('svg');
    if (!icon) return;
    const iconRect = icon.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    animate(icon, false);
    setFeedback({
      left: `${iconRect.left - buttonRect.left - button.clientLeft}px`,
      top: `${iconRect.top - buttonRect.top - button.clientTop}px`,
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

  const onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = async (
    event
  ) => {
    const handler = local.onClick;
    if (!handler || pending || button.disabled) return;
    pending = true;
    clearFeedback();
    try {
      const result: unknown = await (typeof handler === 'function'
        ? handler(event)
        : handler[0](handler[1], event));
      if (!disposed && result !== false) showSuccess();
    } catch {
      // The caller owns error reporting; rejected copies never show success.
    } finally {
      pending = false;
    }
  };

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

  return (
    <Button
      {...rest}
      ref={mergeRefs((element) => (button = element), local.ref)}
      on:click={onClick}
    >
      {local.children}
      <Show when={feedback()}>
        {(style) => <FeedbackIcon style={style()} />}
      </Show>
    </Button>
  );
}
