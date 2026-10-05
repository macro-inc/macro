import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  children,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Transition } from 'solid-transition-group';

const COLLAPSE_DURATION = 140;

export type CollapseTransitionProps = {
  open: boolean;
  /** Animate this element's size instead of the body's, when flex owns it. */
  container?: () => HTMLElement | undefined;
  axis?: 'height' | 'width';
  collapsedSize?: number;
  /** Resting size when an external layout solver changes size before exit. */
  expandedSize?: number;
  /** Animate absolutely positioned neighbors with the same timing and cleanup. */
  companions?: (transition: {
    opening: boolean;
    from: number;
    interrupted: boolean;
  }) => readonly { target: HTMLElement; keyframes: Keyframe[] }[];
  /** Includes exit content that stays mounted until its animation finishes. */
  onPresenceChange?: (present: boolean) => void;
  /** Settle active motion synchronously before an external layout change. */
  captureController?: (controller: { finish: () => void }) => void;
  children: JSX.Element;
};

/**
 * Animate a disclosure body, or its containing section when flex owns its size.
 * @do Wrap the body that opens and closes; it mounts only while `open`.
 * @do Use `axis="width"` for a side column such as a file tree beside content.
 * @do Supply `expandedSize` when an external layout solver removes space immediately.
 * @do Supply `companions` when absolutely positioned neighbors need matching motion.
 * @do Keep state the body needs across closing outside it; closing unmounts it.
 * @dont Do not add your own height or opacity transition to the body; the
 *   animation measures it and would fight a second one.
 */
export function CollapseTransition(props: CollapseTransitionProps) {
  const content = children(() => (
    <Show when={props.open}>{props.children}</Show>
  ));
  const contentElement = () => {
    const element = content();
    return element instanceof HTMLElement ? element : undefined;
  };
  const container = () => props.container?.() ?? contentElement();
  const axis = () => props.axis ?? 'height';
  const dimensionProperties = () =>
    axis() === 'height'
      ? ({
          min: 'minHeight',
          max: 'maxHeight',
          start: 'paddingTop',
          end: 'paddingBottom',
        } as const)
      : ({
          min: 'minWidth',
          max: 'maxWidth',
          start: 'paddingLeft',
          end: 'paddingRight',
        } as const);
  const sizeOf = (element: HTMLElement) =>
    element.getBoundingClientRect()[axis()];
  let measuredSize: number | undefined;
  let disposed = false;
  let running:
    | { target: HTMLElement; content: HTMLElement; finish: () => void }
    | undefined;

  createResizeObserver(container, (_rect, element) => {
    if (!running) measuredSize = sizeOf(element);
  });
  onMount(() => {
    props.captureController?.({ finish: () => running?.finish() });
    const element = container();
    props.onPresenceChange?.(props.open);
    if (element) measuredSize = sizeOf(element);
  });
  onCleanup(() => {
    disposed = true;
    running?.finish();
  });

  function animate(element: Element, opening: boolean, done: () => void) {
    if (disposed || !(element instanceof HTMLElement) || opening !== props.open)
      return done();

    props.onPresenceChange?.(true);
    const target = props.container?.() ?? element;
    const collapsedSize = props.collapsedSize ?? 0;
    const fromOpacity = running
      ? getComputedStyle(running.content).opacity
      : opening
        ? '0'
        : '1';
    const from = running
      ? sizeOf(running.target)
      : opening
        ? collapsedSize
        : (props.expandedSize ?? measuredSize ?? sizeOf(target));
    // Capture neighbors before releasing an interrupted animation's styles.
    const companions = untrack(() =>
      props.companions?.({ opening, from, interrupted: running !== undefined })
    );
    running?.finish();
    const to = opening ? (props.expandedSize ?? sizeOf(target)) : collapsedSize;
    const style = getComputedStyle(target);
    const {
      min,
      max,
      start: paddingStart,
      end: paddingEnd,
    } = dimensionProperties();
    const startPadding = style[paddingStart];
    const endPadding = style[paddingEnd];

    element.inert = !opening;
    if (
      typeof target.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      props.onPresenceChange?.(opening || props.open);
      done();
      return;
    }

    // Freeze flex allocation only while size is animated; restore natural sizing
    // afterward so async rows, scrolling, and viewport resizes remain unrestricted.
    const sizing = {
      flexGrow: '0',
      flexShrink: '0',
      flexBasis: 'auto',
      [min]: '0',
      [max]: 'none',
      boxSizing: 'border-box',
      overflow: 'clip',
    };
    const options: KeyframeAnimationOptions = {
      duration: COLLAPSE_DURATION,
      easing: 'ease-out',
      fill: 'both',
    };
    const size = target.animate(
      [
        {
          ...sizing,
          [axis()]: `${from}px`,
          [paddingStart]: opening ? '0' : startPadding,
          [paddingEnd]: opening ? '0' : endPadding,
        },
        {
          ...sizing,
          [axis()]: `${to}px`,
          [paddingStart]: opening ? startPadding : '0',
          [paddingEnd]: opening ? endPadding : '0',
        },
      ],
      options
    );
    const opacity = element.animate(
      [{ opacity: fromOpacity }, { opacity: opening ? 1 : 0 }],
      options
    );
    const companionAnimations = companions?.map(({ target, keyframes }) =>
      target.animate(keyframes, options)
    );
    const finish = () => {
      if (running?.finish !== finish) return;
      running = undefined;
      measuredSize = to;
      props.onPresenceChange?.(opening || props.open);
      done();
      size.cancel();
      opacity.cancel();
      companionAnimations?.forEach((animation) => animation.cancel());
    };
    running = { target, content: element, finish };
    size.onfinish = finish;
  }

  return (
    <Transition
      onEnter={(element, done) => animate(element, true, done)}
      onExit={(element, done) => animate(element, false, done)}
    >
      {content()}
    </Transition>
  );
}
