import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { ComposerDragOutcome } from './create-composer-header-drag';
import { createComposerHeaderDrag } from './create-composer-header-drag';

/** One placement owner for pinned cards and composers; reanchoring never remounts content. */
export function createCalendarPanelPlacement(options: {
  boundary: Accessor<HTMLElement | undefined>;
  dock: Accessor<HTMLElement | undefined>;
  surface: Accessor<HTMLElement | undefined>;
  anchor: Accessor<DOMRectReadOnly | undefined>;
  pinned: Accessor<boolean>;
  disabled: Accessor<boolean>;
  onPin: () => void;
  onUnpin: () => void;
  onStart?: () => void;
  onFinish?: (outcome: ComposerDragOutcome) => void;
}) {
  const [version, setVersion] = createSignal(0);
  let frame: number | undefined;
  const measure = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      setVersion((value) => value + 1);
    });
  };
  const drag = createComposerHeaderDrag({
    boundary: () => options.boundary()?.getBoundingClientRect(),
    surface: () => options.surface()?.getBoundingClientRect(),
    pinTarget: () => {
      const sidebar = options
        .boundary()
        ?.querySelector<HTMLElement>('[data-calendar-sidebar]');
      const bounds = sidebar?.getBoundingClientRect();
      return bounds && bounds.width > 0 ? bounds : undefined;
    },
    disabled: options.disabled,
    pinned: options.pinned,
    onPin: options.onPin,
    onUnpin: options.onUnpin,
    onStart: options.onStart,
    onFinish: options.onFinish,
  });
  onMount(() => {
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    onCleanup(() => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  createEffect(() => {
    const observer = new ResizeObserver(measure);
    const boundary = options.boundary();
    const dock = options.dock();
    if (boundary) observer.observe(boundary);
    if (dock) observer.observe(dock);
    const surface = options.surface();
    if (surface) observer.observe(surface);
    onCleanup(() => observer.disconnect());
  });
  const docked = () => options.pinned() && !drag.state.active;
  const dockRect = () => {
    version();
    return options.dock()?.getBoundingClientRect();
  };
  const anchorRect = () => {
    version();
    const dock = dockRect();
    if (docked() && dock)
      return new DOMRect(dock.left, dock.top, 0, dock.height);
    const position = drag.position();
    if (position) return new DOMRect(position.x - 8, position.y, 0, 0);
    const anchor = options.anchor();
    if (anchor) return anchor;
    const boundary = options.boundary()?.getBoundingClientRect();
    const left =
      (boundary?.left ?? 0) +
      Math.max(8, ((boundary?.width ?? window.innerWidth) - 384) / 2);
    return new DOMRect(left, (boundary?.top ?? 0) + 108, 0, 0);
  };
  const maxHeight = () => {
    version();
    if (docked()) return dockRect()?.height;
    const root = options.boundary();
    const boundary =
      root
        ?.querySelector<HTMLElement>('.calendar-view-content')
        ?.getBoundingClientRect() ?? root?.getBoundingClientRect();
    const top = Math.max(16, boundary?.top ?? 16);
    const bottom = Math.min(
      window.innerHeight - 16,
      boundary?.bottom ?? window.innerHeight - 16
    );
    const position = drag.position();
    const surfaceTop =
      position?.y ?? options.surface()?.getBoundingClientRect().top ?? top;
    return Math.max(0, bottom - Math.max(top, surfaceTop));
  };
  return { drag, docked, dockRect, anchorRect, maxHeight };
}
