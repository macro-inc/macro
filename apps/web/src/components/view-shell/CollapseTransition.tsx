import { createResizeObserver } from '@solid-primitives/resize-observer';
import { children, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Transition } from 'solid-transition-group';

const COLLAPSE_DURATION = 140;

/** Animate a disclosure body, or its containing section when flex owns its size. */
export function CollapseTransition(props: {
  open: boolean;
  container?: () => HTMLElement | undefined;
  collapsedHeight?: number;
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
  let measuredHeight: number | undefined;
  let running:
    | { target: HTMLElement; content: HTMLElement; finish: () => void }
    | undefined;

  createResizeObserver(container, (_rect, element) => {
    if (!running) measuredHeight = element.getBoundingClientRect().height;
  });
  onMount(() => {
    measuredHeight = container()?.getBoundingClientRect().height;
  });
  onCleanup(() => running?.finish());

  function animate(element: Element, opening: boolean, done: () => void) {
    if (!(element instanceof HTMLElement)) return done();

    const target = props.container?.() ?? element;
    const collapsedHeight = props.collapsedHeight ?? 0;
    const fromOpacity = running
      ? getComputedStyle(running.content).opacity
      : opening
        ? '0'
        : '1';
    const from = running
      ? running.target.getBoundingClientRect().height
      : opening
        ? collapsedHeight
        : (measuredHeight ?? target.getBoundingClientRect().height);
    running?.finish();
    const to = opening
      ? target.getBoundingClientRect().height
      : collapsedHeight;
    const style = getComputedStyle(target);
    const paddingTop = style.paddingTop;
    const paddingBottom = style.paddingBottom;

    element.inert = !opening;
    if (
      typeof target.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      done();
      return;
    }

    // Freeze flex allocation only while height is animated; restore natural sizing
    // afterward so async rows, scrolling, and viewport resizes remain unrestricted.
    const sizing = {
      flexGrow: '0',
      flexShrink: '0',
      flexBasis: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      boxSizing: 'border-box',
      overflow: 'clip',
    };
    const options: KeyframeAnimationOptions = {
      duration: COLLAPSE_DURATION,
      easing: 'ease-out',
      fill: 'both',
    };
    const height = target.animate(
      [
        {
          ...sizing,
          height: `${from}px`,
          paddingTop: opening ? '0' : paddingTop,
          paddingBottom: opening ? '0' : paddingBottom,
        },
        {
          ...sizing,
          height: `${to}px`,
          paddingTop: opening ? paddingTop : '0',
          paddingBottom: opening ? paddingBottom : '0',
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
      measuredHeight = to;
      done();
      height.cancel();
      opacity.cancel();
    };
    running = { target, content: element, finish };
    height.onfinish = finish;
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
