import { createResizeObserver } from '@solid-primitives/resize-observer';
import { children, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Transition } from 'solid-transition-group';

const COLLAPSE_DURATION = 140;

/** Animate a disclosure body, or its containing section when flex owns its size. */
export function CollapseTransition(props: {
  open: boolean;
  container?: () => HTMLElement | undefined;
  axis?: 'height' | 'width';
  collapsedSize?: number;
  children: JSX.Element;
}) {
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
  let running:
    | { target: HTMLElement; content: HTMLElement; finish: () => void }
    | undefined;

  createResizeObserver(container, (_rect, element) => {
    if (!running) measuredSize = sizeOf(element);
  });
  onMount(() => {
    const element = container();
    if (element) measuredSize = sizeOf(element);
  });
  onCleanup(() => running?.finish());

  function animate(element: Element, opening: boolean, done: () => void) {
    if (!(element instanceof HTMLElement)) return done();

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
        : (measuredSize ?? sizeOf(target));
    running?.finish();
    const to = opening ? sizeOf(target) : collapsedSize;
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
    const finish = () => {
      if (running?.finish !== finish) return;
      running = undefined;
      measuredSize = to;
      done();
      size.cancel();
      opacity.cancel();
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
