import {
  startUiOperation,
  type UiOperation,
} from '@app/observability/ui-operation';
import { createEventListener } from '@solid-primitives/event-listener';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { ComposerDragOutcome } from './create-composer-header-drag';
import { createComposerHeaderDrag } from './create-composer-header-drag';

/** One placement owner for pinned cards and composers; reanchoring never remounts content. */
export function createCalendarPanelPlacement(options: {
  kind: 'composer' | 'event-card';
  boundary: Accessor<HTMLElement | undefined>;
  dock: Accessor<HTMLElement | undefined>;
  surface: Accessor<HTMLElement | undefined>;
  anchor: Accessor<DOMRectReadOnly | undefined>;
  pinned: Accessor<boolean>;
  canPin?: Accessor<boolean>;
  disabled: Accessor<boolean>;
  onPin: () => void;
  onUnpin: () => void;
  onStart?: () => void;
  onFinish?: (outcome: ComposerDragOutcome) => void;
}) {
  const [version, setVersion] = createSignal(0);
  let operation: UiOperation | undefined;
  const telemetry =
    options.kind === 'composer'
      ? {
          name: 'calendar.composer.drag',
          outcome: 'calendar.composer.drag_outcome',
        }
      : {
          name: 'calendar.event_card.drag',
          outcome: 'calendar.event_card.drag_outcome',
        };
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
    canPin: options.canPin,
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
    onStart: () => {
      operation = startUiOperation(telemetry.name);
      options.onStart?.();
    },
    onFinish: (outcome) => {
      options.onFinish?.(outcome);
      operation?.span.setAttr(telemetry.outcome, outcome);
      if (outcome === 'cancelled') operation?.cancel();
      else operation?.afterPaint();
      operation = undefined;
    },
  });
  createEventListener(() => window, 'scroll', measure, { capture: true });
  createEventListener(() => window, 'resize', measure);
  createResizeObserver(
    () =>
      [options.boundary(), options.dock(), options.surface()].filter(
        (element): element is HTMLElement => element !== undefined
      ),
    measure
  );
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    operation?.cancel();
  });
  const docked = () => options.pinned() && !drag.state.active;
  const dockRect = () => {
    version();
    return options.dock()?.getBoundingClientRect();
  };
  const maxHeight = () => {
    version();
    if (docked()) return dockRect()?.height;
    return Math.max(0, window.innerHeight - 32);
  };
  const floatingAnchor = (rect: DOMRectReadOnly) => {
    // Size against the whole viewport first, then move up. Limiting height to
    // the space below the anchor would make bottom-of-screen cards collapse.
    const height = Math.min(
      options.surface()?.getBoundingClientRect().height ?? 0,
      maxHeight() ?? 0
    );
    const maximumTop = Math.max(16, window.innerHeight - 16 - height);
    return new DOMRect(
      rect.x,
      Math.min(maximumTop, Math.max(16, rect.y)),
      rect.width,
      rect.height
    );
  };
  const anchorRect = () => {
    version();
    const dock = dockRect();
    if (docked() && dock)
      return new DOMRect(dock.left, dock.top, 0, dock.height);
    const position = drag.position();
    if (position) {
      const rect = new DOMRect(position.x - 8, position.y, 0, 0);
      // While held, keep the header under the pointer. Settle the complete card
      // inside the viewport on release, including when dragging out of a dock.
      return drag.state.active ? rect : floatingAnchor(rect);
    }
    const anchor = options.anchor();
    if (anchor) return floatingAnchor(anchor);
    const boundary = options.boundary()?.getBoundingClientRect();
    const left =
      (boundary?.left ?? 0) +
      Math.max(8, ((boundary?.width ?? window.innerWidth) - 384) / 2);
    return floatingAnchor(new DOMRect(left, (boundary?.top ?? 0) + 108, 0, 0));
  };
  return { drag, docked, dockRect, anchorRect, maxHeight };
}
