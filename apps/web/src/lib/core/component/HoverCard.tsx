import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type HoverCardRootProps,
  HoverCard as KobalteHoverCard,
} from '@kobalte/core/hover-card';
import { cn } from '@ui/utils/classname';
import type { Accessor, JSX, Setter } from 'solid-js';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
} from 'solid-js';

type NestedHoverCardContext = {
  count: () => number;
  setCount: Setter<number>;
  entry: HoverCardEntry;
};

const HoverCardPortalNestedPreviewOpenContext = createContext<
  NestedHoverCardContext | undefined
>(undefined);

/**
 * Keeps the nearest parent hover card mounted while a portaled child surface
 * is active. Use this for menus and editors whose content leaves the hover
 * card's DOM subtree when it opens.
 */
export function useHoldParentHoverCardOpen(active: Accessor<boolean>) {
  const parentContext = useContext(HoverCardPortalNestedPreviewOpenContext);

  createEffect(() => {
    if (!parentContext || !active()) return;
    parentContext.setCount((count) => count + 1);
    onCleanup(() => parentContext.setCount((count) => count - 1));
  });
}

/** Returns whether the calling component is rendered inside a hover card. */
export function useIsInsideHoverCard() {
  return useContext(HoverCardPortalNestedPreviewOpenContext) !== undefined;
}

type HoverCardEntry = {
  parent?: HoverCardEntry;
  close: () => void;
  registeredGroup?: string;
  trigger?: HTMLElement;
};

const DEFAULT_CHOKE_GROUP = 'hover-card';

// Kobalte hover-card instances do not coordinate with each other. Keep one
// open branch per group: a card opened from another card's *content* preserves
// its ancestors, while every unrelated card (including one whose trigger is
// merely inside another trigger) is closed.
const openHoverCardsByGroup = new Map<string, Set<HoverCardEntry>>();

function isAncestor(candidate: HoverCardEntry, entry: HoverCardEntry) {
  let parent = entry.parent;
  while (parent) {
    if (parent === candidate) return true;
    parent = parent.parent;
  }
  return false;
}

export type HoverCardComponentProps = {
  /** The trigger content to hover over */
  trigger: JSX.Element;
  /** The content to show in the hover card */
  content: JSX.Element;
  /** Additional class for content */
  anchorRef?: HTMLElement;
  /** Open delay in ms (default: 100) */
  openDelay?: number;
  /** Close delay in ms (default: 150) */
  closeDelay?: number;
  /** Gutter spacing (default: 8) */
  gutter?: number;
  /** Additional class for content */
  contentClass?: string;
  /** Receives the underlying Kobalte content element. */
  contentRef?: (element: HTMLElement) => void;
  /** Semantic z-index class for the portaled content. Defaults to `z-tool-tip`. */
  contentZIndexClass?: string;
  /**
   * Element type Kobalte should render the trigger as. Defaults to `span`.
   * Use `div` for block-level children or `nav` for navigation triggers.
   */
  triggerAs?: 'span' | 'div' | 'nav';
  /** Accessible label applied to the trigger element. */
  triggerAriaLabel?: string;
  /** Class applied to the underlying trigger element. */
  triggerClass?: string;
  /** Receives the underlying Kobalte trigger element. */
  triggerRef?: (element: HTMLElement) => void;
  /** Tab index for the trigger element. Use -1 to remove from tab order. */
  triggerTabIndex?: number;
  /** Whether to disable the hover card */
  disabled?: boolean;
  /**
   * Cards in the same choke group share one open branch. Opening an unrelated
   * card closes the current branch; opening a card rendered inside another
   * card's content preserves its ancestors. Defaults to the app-wide rich
   * hover-card group. Pass false to opt out of coordination.
   */
  chokeGroup?: string | false;
  /**
   * Don't open from the synthetic pointerenter fired when the trigger mounts
   * under a stationary cursor (e.g. a chip inserted via keyboard); require
   * real pointer movement first.
   */
  requirePointerMovement?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional controlled open state. When provided, the consumer is
   * responsible for syncing it via `onOpenChange` (e.g. so inner content
   * can dismiss the card via a close callback).
   */
  open?: boolean;
  /** Element that should receive the portaled hover-card content. */
  portalMount?: HTMLElement;
  /** Placement of the hover card */
  placement?: HoverCardRootProps['placement'];
  /** Whether the card should flip when it would overflow. */
  flip?: HoverCardRootProps['flip'];
  /** Whether the card should be constrained to the viewport. */
  fitViewport?: HoverCardRootProps['fitViewport'];
  /** Minimum distance between the card and the viewport edge. */
  overflowPadding?: HoverCardRootProps['overflowPadding'];
};

/**
 * A hover card component that supports nested hover cards.
 * When nested hover cards are open, parent cards are force-mounted to prevent closing.
 */
export function HoverCard(props: HoverCardComponentProps) {
  const parentNestedContext = useContext(
    HoverCardPortalNestedPreviewOpenContext
  );

  const [nestedOpenCount, setNestedOpenCount] = createSignal(0);
  const [isHoverCardOpen, setIsHoverCardOpen] = createSignal(false);
  let contentEl: HTMLElement | undefined;

  let entry: HoverCardEntry;

  const unregister = () => {
    const group = entry.registeredGroup;
    if (group === undefined) return;

    const entries = openHoverCardsByGroup.get(group);
    entries?.delete(entry);
    if (entries?.size === 0) openHoverCardsByGroup.delete(group);
    entry.registeredGroup = undefined;
  };

  const closeSelf = () => {
    unregister();
    setIsHoverCardOpen(false);
    props.onOpenChange?.(false);
  };

  entry = {
    parent: parentNestedContext?.entry,
    close: closeSelf,
  };

  const register = (): boolean => {
    const group = props.chokeGroup ?? DEFAULT_CHOKE_GROUP;
    if (group === false) {
      unregister();
      return true;
    }

    if (entry.registeredGroup !== group) unregister();

    let entries = openHoverCardsByGroup.get(group);
    if (!entries) {
      entries = new Set();
      openHoverCardsByGroup.set(group, entries);
    }

    const competitors = [...entries].filter(
      (openEntry) => openEntry !== entry && !isAncestor(openEntry, entry)
    );

    // When triggers contain each other, the deepest trigger is the user's
    // actual target. Keep it even if a broader ancestor trigger's longer open
    // delay expires afterward.
    const deeperTriggerIsOpen = competitors.some(
      (openEntry) =>
        entry.trigger &&
        openEntry.trigger &&
        entry.trigger.contains(openEntry.trigger)
    );
    if (deeperTriggerIsOpen) return false;

    // Register before closing competitors so their `unregister` calls cannot
    // remove this group's set from the map during the handoff.
    entries.add(entry);
    entry.registeredGroup = group;

    for (const openEntry of competitors) {
      openEntry.close();
    }

    return true;
  };

  const isDisabled = () => props.disabled || isTouchDevice();

  // Keep the internal open signal in sync with controlled `open` so the
  // nested-card tracking and choke group still work when consumers control state.
  createEffect(() => {
    if (props.open !== undefined) {
      const open = props.open && !isDisabled();
      const accepted = open ? register() : false;
      if (!open) unregister();
      setIsHoverCardOpen(accepted);
      if (open && !accepted) props.onOpenChange?.(false);
    }
  });

  // `disabled` is reactive (property cards use it while their editor popover
  // is open), so an already-open uncontrolled card must close immediately.
  createEffect(() => {
    if (isDisabled() && isHoverCardOpen()) closeSelf();
  });

  createEffect(() => {
    if (isHoverCardOpen()) {
      parentNestedContext?.setCount((c) => c + 1);
      onCleanup(() => {
        parentNestedContext?.setCount((c) => c - 1);
      });
    }
  });

  // Distinguish real hovers from the synthetic pointerenter browsers fire
  // when the trigger mounts under a stationary cursor: only coordinate
  // changes across pointermove events count as movement (synthetic moves
  // repeat the same position).
  let pointerMoved = false;
  if (props.requirePointerMovement) {
    let lastX: number | undefined;
    let lastY: number | undefined;
    const onPointerMove = (e: PointerEvent) => {
      if (lastX !== undefined && (e.screenX !== lastX || e.screenY !== lastY)) {
        pointerMoved = true;
        window.removeEventListener('pointermove', onPointerMove, true);
        return;
      }
      lastX = e.screenX;
      lastY = e.screenY;
    };
    window.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: true,
    });
    onCleanup(() =>
      window.removeEventListener('pointermove', onPointerMove, true)
    );
  }

  const handleOpenChange = (open: boolean) => {
    if (
      open &&
      (isDisabled() || (props.requirePointerMovement && !pointerMoved))
    ) {
      return;
    }

    if (!open && nestedOpenCount() > 0) {
      return;
    }

    if (open && !register()) {
      setIsHoverCardOpen(false);
      props.onOpenChange?.(false);
      return;
    }
    if (!open) unregister();

    setIsHoverCardOpen(open);
    props.onOpenChange?.(open);
  };

  onCleanup(unregister);

  const shouldForceMount = () => nestedOpenCount() > 0;

  // Dismiss on scroll outside the card content. Kobalte only listens for
  // pointermove to detect leaving the trigger, so a static cursor during
  // rapid scrolling never fires the close — leaving cards stranded as new
  // triggers slide under the cursor.
  createEffect(() => {
    if (!isHoverCardOpen()) return;

    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (contentEl && target && contentEl.contains(target)) return;
      handleOpenChange(false);
    };

    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      window.removeEventListener('scroll', onScroll, true);
    });
  });

  return (
    <KobalteHoverCard
      getAnchorRect={
        props.anchorRef &&
        ((_triggerAnchor) => {
          return props.anchorRef?.getBoundingClientRect();
        })
      }
      placement={props.placement ?? 'bottom-start'}
      flip={props.flip}
      fitViewport={props.fitViewport}
      overflowPadding={props.overflowPadding}
      openDelay={props.openDelay ?? 100}
      closeDelay={props.closeDelay ?? 150}
      gutter={props.gutter ?? 8}
      open={!isDisabled() && isHoverCardOpen()}
      onOpenChange={handleOpenChange}
      forceMount={shouldForceMount()}
    >
      <KobalteHoverCard.Trigger
        ref={(element) => {
          entry.trigger = element;
          props.triggerRef?.(element);
        }}
        as={props.triggerAs ?? 'span'}
        aria-label={props.triggerAriaLabel}
        class={props.triggerClass}
        disabled={isDisabled()}
        tabIndex={props.triggerTabIndex}
      >
        {props.trigger}
      </KobalteHoverCard.Trigger>

      <KobalteHoverCard.Portal mount={props.portalMount}>
        <KobalteHoverCard.Content
          ref={(el) => {
            contentEl = el;
            props.contentRef?.(el);
          }}
          class={cn(
            props.contentZIndexClass ?? 'z-tool-tip',
            props.contentClass
          )}
        >
          <HoverCardPortalNestedPreviewOpenContext.Provider
            value={{
              count: nestedOpenCount,
              setCount: setNestedOpenCount,
              entry,
            }}
          >
            {props.content}
          </HoverCardPortalNestedPreviewOpenContext.Provider>
        </KobalteHoverCard.Content>
      </KobalteHoverCard.Portal>
    </KobalteHoverCard>
  );
}
