import {
  type HoverCardRootProps,
  HoverCard as KobalteHoverCard,
} from '@kobalte/core/hover-card';
import type { JSX, Setter } from 'solid-js';
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
};

const HoverCardPortalNestedPreviewOpenContext = createContext<
  NestedHoverCardContext | undefined
>(undefined);

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
  /**
   * Element type Kobalte should render the trigger as. Defaults to `span`.
   * Use `div` when the trigger child is itself block-level (e.g. a chip).
   */
  triggerAs?: 'span' | 'div';
  /** Class applied to the underlying trigger element. */
  triggerClass?: string;
  /** Whether to disable the hover card */
  disabled?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional controlled open state. When provided, the consumer is
   * responsible for syncing it via `onOpenChange` (e.g. so inner content
   * can dismiss the card via a close callback).
   */
  open?: boolean;
  /** Placement of the hover card */
  placement?: HoverCardRootProps['placement'];
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

  // Keep the internal open signal in sync with controlled `open` so the
  // nested-card tracking effect below still fires when consumers control state.
  createEffect(() => {
    if (props.open !== undefined) {
      setIsHoverCardOpen(props.open);
    }
  });

  createEffect(() => {
    if (isHoverCardOpen()) {
      parentNestedContext?.setCount((c) => c + 1);
      onCleanup(() => {
        parentNestedContext?.setCount((c) => c - 1);
      });
    }
  });

  const handleOpenChange = (open: boolean) => {
    if (!open && nestedOpenCount() > 0) {
      return;
    }

    setIsHoverCardOpen(open);
    props.onOpenChange?.(open);
  };

  const shouldForceMount = () => nestedOpenCount() > 0;

  return (
    <KobalteHoverCard
      getAnchorRect={
        props.anchorRef &&
        ((_triggerAnchor) => {
          return props.anchorRef?.getBoundingClientRect();
        })
      }
      placement={props.placement ?? 'bottom-start'}
      openDelay={props.openDelay ?? 100}
      closeDelay={props.closeDelay ?? 150}
      gutter={props.gutter ?? 8}
      open={props.open ?? isHoverCardOpen()}
      onOpenChange={handleOpenChange}
      forceMount={shouldForceMount()}
    >
      <KobalteHoverCard.Trigger
        as={props.triggerAs ?? 'span'}
        class={props.triggerClass}
        disabled={props.disabled}
      >
        {props.trigger}
      </KobalteHoverCard.Trigger>

      <KobalteHoverCard.Portal>
        <KobalteHoverCard.Content class={props.contentClass}>
          <HoverCardPortalNestedPreviewOpenContext.Provider
            value={{ count: nestedOpenCount, setCount: setNestedOpenCount }}
          >
            {props.content}
          </HoverCardPortalNestedPreviewOpenContext.Provider>
        </KobalteHoverCard.Content>
      </KobalteHoverCard.Portal>
    </KobalteHoverCard>
  );
}
