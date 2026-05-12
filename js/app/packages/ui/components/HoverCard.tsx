import { HoverCard as KobalteHoverCard } from '@kobalte/core/hover-card';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';
import { cn, Surface } from '@ui';

const DEFAULT_PLACEMENT: Placement = 'bottom';
const OVERFLOW_PADDING = 16;
const VIEWPORT_PADDING = 16;
const FIT_VIEWPORT = true;
const GUTTER = 4;
const DELAY = 250;
const FLIP = true;

export type HoverCardProps = ParentProps<{
  /** JSX content shown inside the hover surface. */
  content: JSX.Element;
  /** Skip the default `Surface` chrome so callers can style the content themselves. */
  unstyled?: boolean;
  onOpenChange?: (open: boolean) => void;
  ref?: (el: HTMLElement) => void;
  placement?: Placement;
  as?: 'div' | 'span';
  open?: boolean;
  class?: string;
}>;

/**
 * A hover-engaged surface for rich JSX content.
 *
 * Use when you need to display arbitrary markup on hover (icons, lists,
 * structured info, selectable text). For a simple text+hotkey label,
 * use `Tooltip` instead. For click-engaged surfaces, use `Popover`.
 *
 * @example
 * <HoverCard content={<UserCard userId={id} />}>
 *   <UserAvatar id={id} />
 * </HoverCard>
 *
 * <HoverCard unstyled content={<CustomBox />}>
 *   <Trigger />
 * </HoverCard>
 */
export function HoverCard(props: HoverCardProps) {
  return (
    <KobalteHoverCard
      placement={props.placement ?? DEFAULT_PLACEMENT}
      overflowPadding={OVERFLOW_PADDING}
      onOpenChange={props.onOpenChange}
      fitViewport={FIT_VIEWPORT}
      closeDelay={DELAY}
      openDelay={DELAY}
      open={props.open}
      gutter={GUTTER}
      flip={FLIP}
    >
      <KobalteHoverCard.Trigger
        class={cn('inline-flex items-center', props.class)}
        ref={(el: HTMLElement) => { props.ref?.(el); }}
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteHoverCard.Trigger>
      <KobalteHoverCard.Portal>
        <KobalteHoverCard.Content
          style={{ 'max-width': `calc(100vw - ${2 * VIEWPORT_PADDING}px)` }}
          class="z-tool-tip"
        >
          <Show when={!props.unstyled} fallback={props.content}>
            <Surface
              class="flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word"
              depth={3}
            >
              {props.content}
            </Surface>
          </Show>
        </KobalteHoverCard.Content>
      </KobalteHoverCard.Portal>
    </KobalteHoverCard>
  );
}
