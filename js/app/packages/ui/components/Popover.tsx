import { Popover as KobaltePopover } from '@kobalte/core/popover';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

/*
<Popover open={open()} onOpenChange={setOpen} placement="bottom">
  <Popover.Trigger>{avatar}</Popover.Trigger>
  <Popover.Content>
    <Popover.Surface>
      ...rich, interactive content...
    </Popover.Surface>
  </Popover.Content>
</Popover>
*/

type PopoverProps = ParentProps<{
  onOpenChange?: (open: boolean) => void;
  /** Forwarded to Kobalte; controls whether focus is trapped + page made inert. */
  modal?: boolean;
  placement?: Placement;
  /** Distance (px) between the trigger and the popover content. Defaults to 4. */
  gutter?: number;
  open?: boolean;
}>;

type TriggerProps = ParentProps<{
  /**
   * Element type Kobalte should render the trigger as.
   *
   * Defaults to `button` — the semantically correct choice for a
   * click-engaged trigger. Use `span` when the trigger lives inside
   * inline text (e.g. an `@mention` or a recipient chip embedded in a
   * sentence) and `div` when the trigger is a block-level affordance
   * that already contains its own button-like child.
   */
  as?: 'button' | 'div' | 'span';
  ref?: (el: HTMLElement) => void;
  onClick?: (e: MouseEvent) => void;
  class?: string;
}>;

type ContentProps = ParentProps<{ class?: string }>;

type SurfaceSlotProps = ParentProps<{ class?: string }>;

const DEFAULT_PLACEMENT: Placement = 'bottom';
const POPOVER_OVERFLOW_PADDING = 16;
const POPOVER_VIEWPORT_PADDING = 16;
const POPOVER_FIT_VIEWPORT = true;
const POPOVER_GUTTER = 4;
const POPOVER_FLIP = true;

function PopoverTrigger(props: TriggerProps) {
  return (
    <KobaltePopover.Trigger
      as={props.as ?? 'button'}
      ref={(el: HTMLElement) => { props.ref?.(el); }}
      onClick={props.onClick}
      class={cn(
        'inline-flex items-center cursor-pointer outline-none',
        props.class
      )}
    >
      {props.children}
    </KobaltePopover.Trigger>
  );
}

function PopoverContent(props: ContentProps) {
  return (
    <KobaltePopover.Portal>
      <KobaltePopover.Content
        style={{ 'max-width': `calc(100vw - ${2 * POPOVER_VIEWPORT_PADDING}px)` }}
        class={cn('z-action-menu outline-none', props.class)}
      >
        {props.children}
      </KobaltePopover.Content>
    </KobaltePopover.Portal>
  );
}

/**
 * Default chrome for popover content: bordered, elevated surface with
 * comfortable padding for interactive UI. Use this for the common case;
 * skip it and roll your own `<Surface>` / `<div>` when you need bespoke
 * styling.
 */
function PopoverSurface(props: SurfaceSlotProps) {
  return (
    <Surface
      depth={3}
      class={cn(
        'p-2 text-ink text-sm shadow-md',
        props.class
      )}
    >
      {props.children}
    </Surface>
  );
}

export function Popover(props: PopoverProps): JSX.Element {
  return (
    <KobaltePopover
      placement={props.placement ?? DEFAULT_PLACEMENT}
      overflowPadding={POPOVER_OVERFLOW_PADDING}
      fitViewport={POPOVER_FIT_VIEWPORT}
      onOpenChange={props.onOpenChange}
      gutter={props.gutter ?? POPOVER_GUTTER}
      modal={props.modal}
      flip={POPOVER_FLIP}
      open={props.open}
    >
      {props.children}
    </KobaltePopover>
  );
}

Popover.Trigger = PopoverTrigger;
Popover.Content = PopoverContent;
Popover.Surface = PopoverSurface;
Popover.Anchor = KobaltePopover.Anchor;
Popover.Close = KobaltePopover.CloseButton;
