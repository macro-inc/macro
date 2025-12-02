import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  Index,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createResizeSolver } from './solver';
import type { PanelConfig, PanelId, ResizeZoneCtx } from './types';

export const ResizeZoneContext = createContext<ResizeZoneCtx>();

/**
 * Props for the Resize Zone component.
 *
 * @property direction - The direction of the zone. The direction of the flow, not the splits.
 * @property gutter - The size of gutters (in px).
 * @property minSize - The zone-wide min size for a panel (in px). Individual panels can override.
 * @property class - Optional class name for the Zone.
 * @property id - Optional id for the Zone.
 */
type ZoneProps = {
  direction: 'horizontal' | 'vertical';
  gutter?: number;
  minSize?: number;
  class?: string;
  id?: string;
  captureResizeCtx?: (ctx: ResizeZoneCtx) => void;
};

/**
 * The main container component for resizable panels.
 *
 * Creates a zone where panels can be arranged and resized either horizontally or vertically.
 * Manages the layout calculation, gutter positioning, and provides context for child panels.
 * Also provides hide/show functionality through the context.
 *
 * @param props - The zone configuration properties
 * @returns A resizable zone container with panels and gutters
 *
 * @example
 * ```tsx
 * <Resize.Zone direction="horizontal" gutter={8} minSize={100}>
 *   <Resize.Panel id="panel1" minSize={150}>
 *     Content 1
 *   </Resize.Panel>
 *   <Resize.Panel id="panel2" minSize={200}>
 *     Content 2
 *   </Resize.Panel>
 * </Resize.Zone>
 *
 * // Access hide/show functionality via context
 * const ctx = useContext(ResizeZoneContext);
 * ctx.hide('panel1'); // Temporarily hide panel1, others flow around it
 * ctx.show('panel1'); // Show panel1 again
 * ```
 */
function Zone(props: ParentProps<ZoneProps>) {
  // NOT REACTIVE on direction on purpose.
  const { direction } = props;

  const gutterPx = () => props.gutter ?? 0;
  const minSize = () => props.minSize ?? 0;

  const [root, setRoot] = createSignal<HTMLDivElement>();
  const rootSize = createElementSize(root);
  const zoneSize = createMemo(() => {
    return direction === 'horizontal'
      ? (rootSize.width ?? 0)
      : (rootSize.height ?? 0);
  });

  const solver = createResizeSolver({
    direction,
    gutter: gutterPx,
    size: zoneSize,
    panels: [],
  });

  function register(config: PanelConfig) {
    solver.addPanel({ ...config, minSize: config?.minSize ?? minSize() });
  }

  function unregister(id: PanelId) {
    solver.dropPanel(id);
  }

  const layouts = createMemo(() => {
    const solve = solver.solve();
    return solver.order().map((id) => ({
      offset: solve.offsets.get(id) ?? 0,
      size: solve.sizes.get(id) ?? 0,
    }));
  });

  const len = () => layouts().length;

  const offsetOf = (id: PanelId) =>
    createMemo(() => solver.solve().offsets.get(id) ?? 0);

  const sizeOf = (id: PanelId) =>
    createMemo(() => solver.solve().sizes.get(id) ?? 0);

  const ctx: ResizeZoneCtx = {
    direction,
    register,
    unregister,
    gutterSize: gutterPx,
    size: zoneSize,
    offsetOf,
    sizeOf,
    canFit: solver.canFitPanel,
    hide: solver.hide,
    show: solver.show,
    isHidden: solver.isHidden,
  };

  createEffect(() => {
    props.captureResizeCtx?.(ctx);
  });

  return (
    <div
      class={props.class ?? ''}
      ref={setRoot}
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
      }}
      data-resize-zone
    >
      <ResizeZoneContext.Provider value={ctx}>
        {props.children}
        <Show when={len() > 1}>
          <Index each={layouts()}>
            {(panel, i) => (
              <Show when={i < len() - 1}>
                <Gutter
                  offset={panel().offset + panel().size}
                  index={i}
                  nudge={solver.moveHandle}
                />
              </Show>
            )}
          </Index>
        </Show>
      </ResizeZoneContext.Provider>
    </div>
  );
}

/**
 * Props for the Resize Panel component.
 *
 * @property id - Unique identifier for the panel
 * @property minSize - Minimum size constraint for the panel in pixels
 * @property maxSize - Maximum size constraint for the panel in pixels (defaults to Infinity)
 * @property collapsed - Accessor that returns whether the panel should be collapsed. This
 *     is currently kind of COPE and should be avoided. Is used for the side-bar which should
 *     be toggled without being unmounted. It is WAY preferred to let the system derive its
 *     state from the component lifecycle.
 * @property hidden - Accessor that returns whether the panel should be hidden (temporarily
 *     removed from layout but still registered). When hidden, other panels flow around it.
 */
type PanelProps = {
  id: PanelId;
  minSize: number;
  maxSize?: number;
  collapsed?: () => boolean;
  hidden?: () => boolean;
};

/**
 * A resizable panel component that renders within a Resize.Zone.
 *
 * Automatically registers and unregisters itself with the parent zone,
 * manages its own positioning and sizing based on the zone's layout calculations,
 * and can be conditionally collapsed, hidden, or made invisible.
 *
 * @param props - Panel configuration and content properties
 * @returns A positioned and sized panel container
 *
 * @example
 * ```tsx
 * <Resize.Panel
 *   id="sidebar"
 *   minSize={200}
 *   maxSize={400}
 *   collapsed={() => sidebarCollapsed()}
 *   hidden={() => sidebarHidden()}
 * >
 *   <div>Sidebar content</div>
 * </Resize.Panel>
 *
 * // Hidden panels are temporarily removed from layout but stay registered
 * // Other panels will flow to fill the space, and the panel can be shown again
 * ```
 */
function Panel(props: ParentProps<PanelProps>) {
  const ctx = useContext(ResizeZoneContext);
  if (!ctx) throw new Error('<Resize.Panel> must be inside <Resize.Zone>');

  onMount(() => {
    if (props.collapsed?.() === false) return;
    ctx.register({
      id: props.id,
      minSize: props.minSize,
      maxSize: props.maxSize ?? Infinity,
    });
  });

  createEffect(() => {
    const collapsed = props.collapsed?.();
    if (collapsed === undefined) return;
    if (collapsed) {
      ctx.unregister(props.id);
    } else {
      ctx.register({
        id: props.id,
        minSize: props.minSize,
        maxSize: props.maxSize ?? Infinity,
      });
    }
  });

  createEffect(() => {
    const hidden = props.hidden?.();
    if (hidden === undefined) return;
    if (hidden) {
      ctx.unregister(props.id);
    } else {
      ctx.register({
        id: props.id,
        minSize: props.minSize,
        maxSize: props.maxSize ?? Infinity,
      });
    }
  });

  onCleanup(() => ctx.unregister(props.id));

  const offset = createMemo(ctx.offsetOf(props.id));
  const size = createMemo(ctx.sizeOf(props.id));

  const styles = createMemo(() => {
    if (ctx.direction === 'horizontal') {
      return {
        top: '0px',
        bottom: '0px',
        height: '100%',
        left: offset() + 'px',
        width: size() + 'px',
      };
    } else {
      return {
        left: '0px',
        right: '0px',
        width: '100%',
        top: offset() + 'px',
        height: size() + 'px',
      };
    }
  });

  return (
    <div
      classList={{
        hidden: props.collapsed?.(),
      }}
      style={{
        position: 'absolute',
        ...styles(),
      }}
      data-resize-panel
    >
      {props.children}
    </div>
  );
}

/**
 * Props for the Gutter component (internal).
 *
 * @property offset - The offset position of the gutter in pixels
 * @property index - The index of the gutter in the layout
 * @property nudge - Function to call when the gutter is moved, with index and movement amount
 */
type GutterProps = {
  offset: number;
  index: number;
  nudge: (index: number, amt: number) => void;
};

function Gutter(props: GutterProps) {
  const ctx = useContext(ResizeZoneContext);
  if (!ctx) throw new Error('<Resize.Gutter> must be inside <Resize.Zone>');
  const styles = createMemo(() => {
    if (ctx.direction === 'horizontal') {
      return {
        top: '0px',
        bottom: '0px',
        height: '100%',
        left: props.offset + 'px',
        width: ctx.gutterSize() + 'px',
      };
    } else {
      return {
        left: '0px',
        right: '0px',
        width: '100%',
        top: props.offset + 'px',
        height: ctx.gutterSize() + 'px',
      };
    }
  });

  let [ptrDown, setPtrDown] = createSignal(false);

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    setPtrDown(true);
    ev.preventDefault();
  }

  function onPointerMove(ev: PointerEvent) {
    if (!ptrDown) return;
    const delta = ctx?.direction === 'horizontal' ? ev.movementX : ev.movementY;
    props.nudge(props.index, delta);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    setPtrDown(false);
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (ctx?.direction === 'horizontal') {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    } else {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    const step = ev.shiftKey ? 100 : 20;
    if (ctx?.direction === 'horizontal') {
      const sign = ev.key === 'ArrowLeft' ? -1 : 1;
      props.nudge(props.index, sign * step);
    } else {
      const sign = ev.key === 'ArrowUp' ? -1 : 1;
      props.nudge(props.index, sign * step);
    }
  }

  return (
    <div
      class="group"
      role="separator"
      aria-orientation={
        ctx.direction === 'horizontal' ? 'vertical' : 'horizontal'
      }
      tabIndex={0}
      aria-label={`resize at ${props.index}`}
      style={{
        position: 'absolute',
        cursor:
          ctx.direction === 'horizontal'
            ? 'var(--cursor-col-resize)'
            : 'var(--cursor-row-resize)',
        ...styles(),
      }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div
        class="border-accent absolute opacity-0 group-focus:opacity-100"
        classList={{
          'group-hover:opacity-50': !ptrDown(),
          'opacity-100': ptrDown(),
        }}
        style={{
          left: ctx.direction === 'horizontal' ? '50%' : '0',
          top: ctx.direction === 'vertical' ? '50%' : '0',
          width: ctx.direction === 'horizontal' ? '0' : '100%',
          height: ctx.direction === 'vertical' ? '0' : '100%',
          'border-left-width': ctx.direction === 'horizontal' ? '1px' : '0',
          'border-top-width': ctx.direction === 'vertical' ? '1px' : '0',
          transform:
            ctx.direction === 'horizontal'
              ? 'translate(-0.5px, 0)'
              : 'translate(0, -0.5px)',
        }}
      ></div>
    </div>
  );
}

/**
 * Resize component system for creating resizable panel layouts.
 *
 * Provides a Zone container that manages the overall layout and Panel
 * components that represent individual resizable sections. Gutter and drag
 * handles are managed automatically.
 *
 * @example
 * ```tsx
 * <Resize.Zone direction="horizontal" gutter={4}>
 *   <Resize.Panel id="nav" minSize={200}>
 *     <Navigation />
 *   </Resize.Panel>
 *   <Resize.Panel id="main" minSize={400}>
 *     <MainContent />
 *   </Resize.Panel>
 * </Resize.Zone>
 * ```
 */
export const Resize = { Zone, Panel };
