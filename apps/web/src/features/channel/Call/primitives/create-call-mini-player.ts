import { usePreference } from '@app/preferences/use-preference';
import { type Accessor, createMemo, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  type CallPlayerCorner,
  type CallPlayerResizeEdge,
  constrainCallPlayerPosition,
  getCallPlayerSnapPreview,
  getCallPlayerSnapTarget,
  MAX_CALL_PLAYER_WIDTH,
  resizeCallPlayer,
} from '../core/call-mini-player';

type Position = { x: number; y: number };
type PreviewSize = { width: number; audioHeight: number };
type SnapPreview = ReturnType<typeof getCallPlayerSnapPreview>;
type Drag = {
  pointer: number;
  x: number;
  y: number;
  left: number;
  top: number;
};
type Resize = {
  pointer: number;
  x: number;
  y: number;
  edge: CallPlayerResizeEdge;
  box: { x: number; y: number; width: number; height: number };
  mediaHeight: number;
  audioOnly: boolean;
  corner: CallPlayerCorner;
};

type PlacementState = {
  corner: CallPlayerCorner;
  position: Position | undefined;
  snapTarget: SnapPreview;
  snapping: boolean;
};
type SizeState = {
  preview: PreviewSize | undefined;
  viewport: { width: number; height: number };
};

export function createCallMiniPlayer(options: {
  root: Accessor<HTMLDivElement>;
  media: Accessor<HTMLDivElement | undefined>;
  audioOnly: Accessor<boolean>;
  reducedMotion: Accessor<boolean>;
}) {
  const [placement, setPlacement] = createStore<PlacementState>({
    corner: 'bottom-right',
    position: undefined,
    snapTarget: undefined,
    snapping: false,
  });
  const [size, setSize] = createStore<SizeState>({
    preview: undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  const [storedWidth, setWidth] = usePreference(
    'macro:pref:call:mini-player-width',
    { default: 336 }
  );
  const [storedAudioHeight, setAudioHeight] = usePreference(
    'macro:pref:call:mini-player-audio-height',
    { default: 144 }
  );
  const visibleSnapTarget = createMemo(
    (previous: SnapPreview) => placement.snapTarget ?? previous
  );
  const width = () => {
    const maximum = Math.max(
      0,
      Math.min(
        MAX_CALL_PLAYER_WIDTH,
        size.viewport.width - 24,
        options.audioOnly()
          ? Infinity
          : ((size.viewport.height - 180) * 16) / 9 + 16
      )
    );
    return Math.max(
      Math.min(256, maximum),
      Math.min(size.preview?.width ?? storedWidth(), maximum)
    );
  };
  const mediaHeight = () =>
    Math.min(
      size.preview?.audioHeight ?? storedAudioHeight(),
      Math.max(144, size.viewport.height - 180)
    );
  const positionStyle = () => {
    const point = placement.position;
    if (point) return { left: `${point.x}px`, top: `${point.y}px` };
    return {
      [placement.corner.endsWith('left') ? 'left' : 'right']: '20px',
      [placement.corner.startsWith('top') ? 'top' : 'bottom']: '20px',
    };
  };
  const atDefaults = () => {
    if (storedWidth() !== 336 || storedAudioHeight() !== 144) return false;
    if (placement.corner !== 'bottom-right') return false;
    const point = placement.position;
    if (!point) return true;
    const box = options.root().getBoundingClientRect();
    const right = size.viewport.width - width() - 20;
    const bottom = size.viewport.height - box.height - 20;
    return Math.abs(point.x - right) < 1 && Math.abs(point.y - bottom) < 1;
  };
  const constrainPosition = (previous: Position | undefined) => {
    if (!previous) return previous;
    const box = options.root().getBoundingClientRect();
    const next = constrainCallPlayerPosition(
      previous.x,
      previous.y,
      box.width,
      box.height,
      window.innerWidth,
      window.innerHeight
    );
    return next.x === previous.x && next.y === previous.y ? previous : next;
  };
  const onViewportResize = () => {
    setSize('viewport', {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPlacement('snapping', false);
    setPlacement('position', (point) => constrainPosition(point));
  };
  window.addEventListener('resize', onViewportResize);
  onCleanup(() => window.removeEventListener('resize', onViewportResize));
  onMount(() => {
    const observer = new ResizeObserver(() => {
      setPlacement('position', (point) => constrainPosition(point));
    });
    observer.observe(options.root());
    onCleanup(() => observer.disconnect());
  });

  let drag: Drag | undefined;
  let resize: Resize | undefined;
  let resetFrame: number | undefined;
  onCleanup(() => {
    if (resetFrame !== undefined) cancelAnimationFrame(resetFrame);
  });
  const resetPlayer = () => {
    setSize('preview', undefined);
    setWidth(336);
    setAudioHeight(144);
    localStorage.removeItem('macro:pref:call:mini-player-width');
    localStorage.removeItem('macro:pref:call:mini-player-audio-height');
    setPlacement({ corner: 'bottom-right', snapTarget: undefined });
    if (resetFrame !== undefined) cancelAnimationFrame(resetFrame);
    resetFrame = requestAnimationFrame(() => {
      resetFrame = undefined;
      const box = options.root().getBoundingClientRect();
      const target = constrainCallPlayerPosition(
        window.innerWidth - box.width - 20,
        window.innerHeight - box.height - 20,
        box.width,
        box.height,
        window.innerWidth,
        window.innerHeight
      );
      const settled =
        Math.abs(box.x - target.x) < 1 && Math.abs(box.y - target.y) < 1;
      if (options.reducedMotion() || settled) {
        setPlacement({ snapping: false, position: undefined });
        return;
      }
      setPlacement({ snapping: true, position: target });
    });
  };
  const finishDrag = (event: PointerEvent, cancelled = false) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const box = options.root().getBoundingClientRect();
    const target = cancelled
      ? undefined
      : getCallPlayerSnapTarget(
          box.x,
          box.y,
          box.width,
          box.height,
          window.innerWidth,
          window.innerHeight
        );
    if (target) {
      setPlacement({
        corner: target.corner,
        snapping: true,
        position: { x: target.x, y: target.y },
      });
    }
    setPlacement('snapTarget', undefined);
    drag = undefined;
  };
  const finishResize = (event: PointerEvent, cancelled = false) => {
    if (!resize || resize.pointer !== event.pointerId) return;
    const preview = size.preview;
    if (!cancelled && preview) {
      setWidth(preview.width);
      if (resize.audioOnly) setAudioHeight(preview.audioHeight);
    } else if (cancelled) {
      setPlacement('position', { x: resize.box.x, y: resize.box.y });
    }
    setSize('preview', undefined);
    resize = undefined;
  };
  const onDragStart = (
    event: PointerEvent & { currentTarget: HTMLElement }
  ) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (drag || resize) return;
    const target = event.target;
    const interactive =
      target instanceof Element && target.closest('button, [role="menu"]');
    if (interactive) return;
    const box = options.root().getBoundingClientRect();
    setPlacement({
      snapping: false,
      snapTarget: undefined,
      position: { x: box.x, y: box.y },
    });
    drag = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: box.left,
      top: box.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const box = options.root().getBoundingClientRect();
    const point = constrainCallPlayerPosition(
      drag.left + event.clientX - drag.x,
      drag.top + event.clientY - drag.y,
      box.width,
      box.height,
      window.innerWidth,
      window.innerHeight
    );
    setPlacement({
      position: point,
      snapTarget: getCallPlayerSnapPreview(
        point.x,
        point.y,
        box.width,
        box.height,
        window.innerWidth,
        window.innerHeight
      ),
    });
  };
  const onResizeStart = (
    edge: CallPlayerResizeEdge,
    event: PointerEvent & { currentTarget: HTMLElement }
  ) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (drag || resize) return;
    event.preventDefault();
    event.stopPropagation();
    setPlacement('snapping', false);
    const box = options.root().getBoundingClientRect();
    resize = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      edge,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      mediaHeight: options.media()?.getBoundingClientRect().height ?? 0,
      audioOnly: options.audioOnly(),
      corner: placement.corner,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: PointerEvent) => {
    if (!resize || resize.pointer !== event.pointerId) return;
    const result = resizeCallPlayer(
      resize.edge,
      resize.box,
      resize.mediaHeight,
      event.clientX - resize.x,
      event.clientY - resize.y,
      window.innerWidth,
      window.innerHeight,
      resize.audioOnly,
      resize.corner
    );
    setSize('preview', {
      width: result.width,
      audioHeight: result.mediaHeight,
    });
    setPlacement('position', { x: result.x, y: result.y });
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== options.root()) return;
    setPlacement('snapping', false);
    const box = options.root().getBoundingClientRect();
    if (placement.corner !== 'bottom-right') return;
    const alignedRight = Math.abs(box.right - (window.innerWidth - 20)) < 1;
    const alignedBottom = Math.abs(box.bottom - (window.innerHeight - 20)) < 1;
    if (alignedRight && alignedBottom) setPlacement('position', undefined);
  };

  const previewAnimations = new Set<Animation>();
  onCleanup(() => {
    for (const animation of previewAnimations) {
      animation.onfinish = null;
      animation.cancel();
    }
  });
  // Keep both media nodes mounted during the fade; Transition removes the old
  // node only after its animation finishes. Reduced motion skips that overlap.
  const animatePreview = (
    element: Element,
    done: () => void,
    entering: boolean
  ) => {
    if (options.reducedMotion() || typeof element.animate !== 'function') {
      done();
      return;
    }
    const animation = element.animate(
      [{ opacity: entering ? 0 : 1 }, { opacity: entering ? 1 : 0 }],
      { duration: 200, easing: 'ease-out' }
    );
    previewAnimations.add(animation);
    animation.onfinish = () => {
      previewAnimations.delete(animation);
      done();
    };
  };

  return {
    placement,
    size,
    visibleSnapTarget,
    width,
    mediaHeight,
    positionStyle,
    atDefaults,
    resetPlayer,
    finishDrag,
    finishResize,
    onDragStart,
    onDragMove,
    onResizeStart,
    onResizeMove,
    onTransitionEnd,
    animatePreview,
  };
}
