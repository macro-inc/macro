import {
  autoUpdate,
  computePosition,
  flip,
  hide,
  offset,
  type Placement,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import XIcon from '@phosphor/x.svg';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '../../utils/classname';
import { Button, type ButtonProps } from '../Button';
import { matchTourTarget, resolveTourTarget, type TourTarget } from './targets';

type Targets = TourTarget | readonly TourTarget[];

/** One stop in a tour. Extend it with app-specific fields through `Tour.Root`'s generic. */
export type TourStep = {
  title: string;
  description: string;
  /** Where the step points, in preference order. Omit for a free-floating step. */
  target?: Targets;
  /**
   * A control that reveals `target` when the target isn't on screen, such as
   * a nav item or a sidebar toggle. While the target is missing, the step
   * waits: the card hides and `Tour.Beacon` marks the entry instead. Pressing
   * the entry, or the target appearing any other way, resumes the step.
   */
  entry?: Targets;
  /** Accessible description of what the entry beacon leads to. */
  entryLabel?: string;
  /** Preferred card placement when the step is anchored. */
  placement?: Placement;
};

/**
 * - `anchored`: the target is on screen.
 * - `waiting`: the target is missing but its entry is on screen and unpressed.
 * - `floating`: nothing to point at; the card floats in the boundary.
 */
export type TourStatus = 'anchored' | 'waiting' | 'floating';

export type TourContextValue<Step extends TourStep = TourStep> = {
  steps: Accessor<readonly Step[]>;
  index: Accessor<number>;
  current: Accessor<Step>;
  isFirst: Accessor<boolean>;
  isLast: Accessor<boolean>;
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  dismiss: () => void;
  complete: () => void;
  status: Accessor<TourStatus>;
  /** The element the current step points at, when anchored. */
  target: Accessor<HTMLElement | undefined>;
  /**
   * Whether the step is anchored to one of its later targets because the
   * first isn't shown, e.g. a feature that isn't set up yet.
   */
  isFallback: Accessor<boolean>;
  /**
   * The last index of the run of steps, starting at the current one, that
   * wait on the same entry. Equal to `index()` when the step has no entry.
   */
  pathEnd: Accessor<number>;
  /** Skips the rest of the current path, completing if nothing follows. */
  skipPath: () => void;
  /** The entry the current step is waiting on, when waiting. */
  entry: Accessor<HTMLElement | undefined>;
  boundary: Accessor<HTMLElement | undefined>;
  titleId: string;
};

const TourContext = createContext<TourContextValue>();

export function useTour<Step extends TourStep = TourStep>() {
  const context = useContext(TourContext);
  if (!context) throw new Error('Tour parts must be used within Tour.Root');
  return context as unknown as TourContextValue<Step>;
}

const toList = (targets: Targets | undefined): readonly TourTarget[] =>
  targets === undefined
    ? []
    : Array.isArray(targets)
      ? targets
      : [targets as TourTarget];

export type TourRootProps<Step extends TourStep> = ParentProps<{
  steps: readonly Step[];
  /** Controlled step index. Pair with `onStepChange`. */
  step?: number;
  onStepChange?: (index: number) => void;
  /** Close button and Escape. */
  onDismiss?: () => void;
  /** `Tour.Next` on the last step. Defaults to `onDismiss`. */
  onComplete?: () => void;
  /**
   * The region the tour belongs to, found from the root's position in the
   * DOM. View-scoped targets resolve only inside it and floating parts stay
   * within it. Defaults to the viewport.
   */
  boundary?: (root: HTMLElement) => HTMLElement | null | undefined;
  /**
   * Entries tried after a step's own, for every step that has a target. Use
   * for controls that reveal most hidden targets, such as a sidebar toggle,
   * so a step never floats unattached while its target is tucked away.
   */
  fallbackEntry?: Targets;
}>;

/** Owns step state and target resolution. Renders nothing visible itself. */
function TourRoot<Step extends TourStep>(props: TourRootProps<Step>) {
  const [ownIndex, setOwnIndex] = createSignal(0);
  const [root, setRoot] = createSignal<HTMLElement>();
  const titleId = createUniqueId();

  const steps = () => props.steps;
  const index = () =>
    Math.min(Math.max(props.step ?? ownIndex(), 0), props.steps.length - 1);
  const current = () => props.steps[index()];
  const boundary = createMemo(() => {
    const element = root();
    return element ? (props.boundary?.(element) ?? undefined) : undefined;
  });

  const match = createMemo(() =>
    matchTourTarget(toList(current().target), boundary())
  );
  const target = () => match()?.element;
  const isFallback = () => {
    const matched = match()?.target;
    return !!matched && matched !== toList(current().target)[0];
  };

  const entryKey = (step: Step) =>
    toList(step.entry)
      .map((entry) => entry.id)
      .join('|');
  const pathEnd = () => {
    const key = entryKey(current());
    let end = index();
    if (!key) return end;
    while (
      end + 1 < props.steps.length &&
      entryKey(props.steps[end + 1]) === key
    )
      end++;
    return end;
  };
  const entries = () => {
    const step = current();
    if (step.target === undefined) return toList(step.entry);
    return [...toList(step.entry), ...toList(props.fallbackEntry)];
  };
  const entry = createMemo(() =>
    target() ? undefined : resolveTourTarget(entries(), boundary())
  );

  // Pressing an entry clears its beacon. It's remembered per element, so
  // when that press reveals the next entry in the chain (a sidebar toggle
  // showing the row to open), the beacon moves there. The target appearing,
  // by any route, forgets it, so leaving again shows the beacon again.
  const [pressedEntry, setPressedEntry] = createSignal<HTMLElement>();
  createEffect(
    on([index, target], () => setPressedEntry(undefined), { defer: true })
  );
  createEffect(() => {
    const element = entry();
    if (!element) return;
    const press = () => setPressedEntry(element);
    element.addEventListener('pointerdown', press, true);
    element.addEventListener('keydown', press, true);
    onCleanup(() => {
      element.removeEventListener('pointerdown', press, true);
      element.removeEventListener('keydown', press, true);
    });
  });

  const status = (): TourStatus =>
    target()
      ? 'anchored'
      : entry() && entry() !== pressedEntry()
        ? 'waiting'
        : 'floating';

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), props.steps.length - 1);
    if (props.step === undefined) setOwnIndex(clamped);
    props.onStepChange?.(clamped);
  };
  const dismiss = () => props.onDismiss?.();
  const complete = () => (props.onComplete ?? props.onDismiss)?.();

  const value: TourContextValue<Step> = {
    steps,
    index,
    current,
    isFirst: () => index() === 0,
    isLast: () => index() === props.steps.length - 1,
    goTo,
    next: () =>
      index() === props.steps.length - 1 ? complete() : goTo(index() + 1),
    previous: () => goTo(index() - 1),
    dismiss,
    complete,
    status,
    target,
    isFallback,
    pathEnd,
    skipPath: () =>
      pathEnd() >= props.steps.length - 1 ? complete() : goTo(pathEnd() + 1),
    entry,
    boundary,
    titleId,
  };

  return (
    <TourContext.Provider value={value as unknown as TourContextValue}>
      <span ref={setRoot} hidden data-tour-root />
      <Show when={props.steps.length > 0}>{props.children}</Show>
    </TourContext.Provider>
  );
}

const EDGE = 16;

/** Keeps `element` positioned against `reference` until cleanup. */
function follow(
  reference: Element | VirtualElement,
  element: HTMLElement,
  update: () => void
) {
  const stop = autoUpdate(reference, element, update);
  onCleanup(stop);
}

/** A virtual point near the boundary's top-right, where unanchored cards rest. */
function restingPoint(boundary: HTMLElement | undefined): VirtualElement {
  return {
    contextElement: boundary,
    getBoundingClientRect() {
      const rect = boundary?.getBoundingClientRect() ?? {
        top: 0,
        right: window.innerWidth,
      };
      const x = rect.right - EDGE;
      const y = rect.top + 72;
      return {
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
      };
    },
  };
}

export type TourPopoverProps = ParentProps<{
  class?: string;
  /** Overrides the step's placement. */
  placement?: Placement;
  /** Gap between the target and the card. */
  gutter?: number;
}>;

/**
 * The step content as a floating, non-modal card next to the target, kept
 * inside the boundary. Hidden while the step waits on its entry.
 *
 * `data-placed` appears once the card is positioned (animate its entrance
 * from there) and `data-settled` a frame later (animate moves between steps
 * only then).
 */
function TourPopover(props: TourPopoverProps) {
  const tour = useTour();
  const [card, setCard] = createSignal<HTMLElement>();
  const [position, setPosition] = createSignal({
    x: 0,
    y: 0,
    maxWidth: 0,
    maxHeight: 0,
    placed: false,
    hidden: false,
  });
  // Position changes animate only once the card has appeared in place, so
  // it rises where it belongs instead of gliding in from the corner.
  const [settled, setSettled] = createSignal(false);
  createEffect(
    on(
      () => position().placed,
      (placed) => {
        if (!placed) return;
        const frame = requestAnimationFrame(() => setSettled(true));
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );

  createEffect(() => {
    const element = card();
    if (!element || tour.status() === 'waiting') return;
    const target = tour.target();
    const boundary = tour.boundary();
    // App-scoped targets live outside the split, so bound by the viewport.
    const inBoundary = !target || !boundary || boundary.contains(target);
    const clip = inBoundary && boundary ? boundary : 'clippingAncestors';
    const placement = target
      ? (props.placement ?? tour.current().placement ?? 'right-start')
      : 'bottom-end';
    const reference = target ?? restingPoint(boundary);
    follow(reference, element, () => {
      void computePosition(reference, element, {
        strategy: 'fixed',
        placement,
        middleware: [
          offset(target ? (props.gutter ?? EDGE) : 0),
          flip({
            boundary: clip,
            padding: EDGE,
            fallbackPlacements: ['left-start', 'bottom-start', 'top-start'],
          }),
          shift({ boundary: clip, padding: EDGE, crossAxis: true }),
          size({
            boundary: clip,
            padding: EDGE,
            apply: ({ availableWidth, availableHeight }) => {
              setPosition((p) => ({
                ...p,
                maxWidth: availableWidth,
                maxHeight: availableHeight,
              }));
            },
          }),
          // Only an anchored card follows its target out of view.
          ...(target ? [hide({ boundary: clip })] : []),
        ],
      }).then(({ x, y, middlewareData }) =>
        setPosition((p) => ({
          ...p,
          x,
          y,
          placed: true,
          hidden: !!middlewareData.hide?.referenceHidden,
        }))
      );
    });
  });

  return (
    <Show when={tour.status() !== 'waiting'}>
      <Portal>
        <section
          ref={setCard}
          role="dialog"
          aria-modal="false"
          aria-labelledby={tour.titleId}
          data-tour-popover
          data-status={tour.status()}
          data-placed={position().placed ? '' : undefined}
          data-settled={settled() ? '' : undefined}
          class={cn('fixed left-0 top-0 z-[70]', props.class)}
          style={{
            transform: `translate3d(${position().x}px, ${position().y}px, 0)`,
            // Transparent until first placed, so it never flashes at 0,0.
            opacity: position().placed ? undefined : 0,
            visibility: position().hidden ? 'hidden' : 'visible',
            'max-width': position().maxWidth
              ? `${position().maxWidth}px`
              : undefined,
            'max-height': position().maxHeight
              ? `${position().maxHeight}px`
              : undefined,
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            tour.dismiss();
          }}
        >
          {props.children}
        </section>
      </Portal>
    </Show>
  );
}

/** The step content inline, in normal flow. Use for docked or embedded tours. */
function TourPanel(props: ParentProps<{ class?: string }>) {
  const tour = useTour();
  return (
    <section
      aria-labelledby={tour.titleId}
      data-tour-panel
      data-status={tour.status()}
      class={props.class}
    >
      {props.children}
    </section>
  );
}

/** Tracks `element`'s rect, clipped to `bounds`, while mounted. */
function createTrackedRect(
  element: Accessor<HTMLElement | undefined>,
  overlay: Accessor<HTMLElement | undefined>,
  bounds: Accessor<HTMLElement | undefined>
) {
  const [rect, setRect] = createSignal<DOMRect>();
  createEffect(() => {
    const source = element();
    const layer = overlay();
    if (!source || !layer) {
      setRect(undefined);
      return;
    }
    follow(source, layer, () => {
      const box = source.getBoundingClientRect();
      const limit = bounds()?.contains(source)
        ? bounds()!.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const left = Math.max(box.left, limit.left);
      const top = Math.max(box.top, limit.top);
      const right = Math.min(box.right, limit.right);
      const bottom = Math.min(box.bottom, limit.bottom);
      setRect(
        right > left && bottom > top
          ? new DOMRect(left, top, right - left, bottom - top)
          : undefined
      );
    });
  });
  return rect;
}

/** An outline around the current target. Renders nothing unless anchored. */
function TourHighlight(props: { class?: string; inset?: number }) {
  const tour = useTour();
  const [ring, setRing] = createSignal<HTMLElement>();
  const rect = createTrackedRect(tour.target, ring, tour.boundary);
  const inset = () => props.inset ?? 4;
  return (
    <Show when={tour.status() === 'anchored'}>
      <Portal>
        <div
          ref={setRing}
          aria-hidden="true"
          data-tour-highlight
          class={cn(
            'pointer-events-none fixed z-[69] rounded-[10px] border border-accent',
            props.class
          )}
          style={{
            visibility: rect() ? 'visible' : 'hidden',
            left: `${(rect()?.left ?? 0) - inset()}px`,
            top: `${(rect()?.top ?? 0) - inset()}px`,
            width: `${(rect()?.width ?? 0) + inset() * 2}px`,
            height: `${(rect()?.height ?? 0) + inset() * 2}px`,
          }}
        />
      </Portal>
    </Show>
  );
}

/**
 * A pulsing marker on the entry the current step is waiting on. It doesn't
 * intercept input: pressing the entry itself clears it and resumes the step.
 */
function TourBeacon(props: { class?: string }) {
  const tour = useTour();
  const [dot, setDot] = createSignal<HTMLElement>();
  const rect = createTrackedRect(tour.entry, dot, tour.boundary);
  return (
    <Show when={tour.status() === 'waiting'}>
      <Portal>
        <span
          ref={setDot}
          data-tour-beacon
          class={cn('pointer-events-none fixed z-[70] size-2.5', props.class)}
          style={{
            visibility: rect() ? 'visible' : 'hidden',
            left: `${(rect()?.right ?? 0) - 16}px`,
            top: `${(rect()?.top ?? 0) + (rect()?.height ?? 0) / 2 - 5}px`,
          }}
        >
          <span class="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
          <span class="absolute inset-0 rounded-full bg-accent" />
        </span>
        <span role="status" class="sr-only">
          {tour.current().entryLabel ??
            `Tour continues: ${tour.current().title}`}
        </span>
      </Portal>
    </Show>
  );
}

export type TourHintProps = ParentProps<{
  class?: string;
  placement?: Placement;
}>;

/**
 * A small floating note beside the entry while the step waits, saying what
 * to press. Unlike the card it doesn't cover the entry, so it can carry
 * controls such as skip or dismiss.
 */
function TourHint(props: TourHintProps) {
  const tour = useTour();
  const [hint, setHint] = createSignal<HTMLElement>();
  const [position, setPosition] = createSignal<{ x: number; y: number }>();
  createEffect(() => {
    const element = hint();
    const entry = tour.entry();
    if (!element || !entry) return;
    follow(entry, element, () => {
      void computePosition(entry, element, {
        strategy: 'fixed',
        placement: props.placement ?? 'right',
        middleware: [
          offset(12),
          flip({ padding: EDGE, fallbackPlacements: ['bottom', 'top'] }),
          shift({ padding: EDGE }),
        ],
      }).then(({ x, y }) => setPosition({ x, y }));
    });
  });
  return (
    <Show when={tour.status() === 'waiting'}>
      <Portal>
        <div
          ref={setHint}
          data-tour-hint
          data-placed={position() ? '' : undefined}
          class={cn('fixed left-0 top-0 z-[70]', props.class)}
          style={{
            transform: `translate3d(${position()?.x ?? 0}px, ${position()?.y ?? 0}px, 0)`,
            opacity: position() ? undefined : 0,
          }}
        >
          {props.children}
        </div>
      </Portal>
    </Show>
  );
}

function TourTitle(props: { class?: string; children?: JSX.Element }) {
  const tour = useTour();
  return (
    <h2 id={tour.titleId} class={props.class}>
      {props.children ?? tour.current().title}
    </h2>
  );
}

function TourDescription(props: { class?: string; children?: JSX.Element }) {
  const tour = useTour();
  return (
    <p class={props.class}>{props.children ?? tour.current().description}</p>
  );
}

/** "2 / 5", announced when the step changes. */
function TourProgress(props: { class?: string }) {
  const tour = useTour();
  return (
    <span aria-live="polite" class={cn('tabular-nums', props.class)}>
      {tour.index() + 1} / {tour.steps().length}
    </span>
  );
}

type TourButtonProps = Omit<ButtonProps, 'onClick'>;

function TourPrevious(props: TourButtonProps) {
  const tour = useTour();
  const [local, others] = splitProps(props, ['children']);
  return (
    <Button
      size="icon-sm"
      label="Previous step"
      disabled={tour.isFirst()}
      {...others}
      onClick={tour.previous}
    >
      {local.children ?? <CaretLeftIcon />}
    </Button>
  );
}

/** Advances, or completes the tour on the last step. */
function TourNext(props: TourButtonProps & { doneLabel?: JSX.Element }) {
  const tour = useTour();
  const [local, others] = splitProps(props, ['children', 'doneLabel']);
  // Text children name the button; only the icon form needs a label.
  const iconOnly = () =>
    local.children === undefined && !(tour.isLast() && local.doneLabel);
  return (
    <Button
      size="icon-sm"
      label={iconOnly() ? 'Next step' : undefined}
      {...others}
      onClick={tour.next}
    >
      <Show
        when={tour.isLast() && local.doneLabel}
        fallback={local.children ?? <CaretRightIcon />}
      >
        {local.doneLabel}
      </Show>
    </Button>
  );
}

function TourClose(props: TourButtonProps) {
  const tour = useTour();
  const [local, others] = splitProps(props, ['children']);
  return (
    <Button
      size="icon-sm"
      label="Dismiss tour"
      {...others}
      onClick={tour.dismiss}
    >
      {local.children ?? <XIcon />}
    </Button>
  );
}

/**
 * Composable product tours. `Root` owns the steps; pick a form for the
 * content (`Popover` floating by the target, or `Panel` inline) and add
 * `Highlight` for the target, and `Beacon` and `Hint` for a waiting entry.
 *
 * @example
 * <Tour.Root steps={steps} onDismiss={dismiss}>
 *   <Tour.Highlight />
 *   <Tour.Beacon />
 *   <Tour.Popover class="w-80 rounded-2xl border border-edge bg-dialog p-5">
 *     <Tour.Title />
 *     <Tour.Description />
 *     <Tour.Previous /> <Tour.Progress /> <Tour.Next doneLabel="Done" />
 *   </Tour.Popover>
 * </Tour.Root>
 */
export const Tour = {
  Root: TourRoot,
  Popover: TourPopover,
  Panel: TourPanel,
  Highlight: TourHighlight,
  Beacon: TourBeacon,
  Hint: TourHint,
  Title: TourTitle,
  Description: TourDescription,
  Progress: TourProgress,
  Previous: TourPrevious,
  Next: TourNext,
  Close: TourClose,
};
