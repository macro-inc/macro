import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Placement } from '@floating-ui/dom';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { createSignal, type JSX, type ParentProps, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

type HoverCardProps = ParentProps<{
  triggerClass?: string;
  contentClass?: string;
  placement?: Placement;
  content: JSX.Element;
  as?: 'div' | 'span';
  /**
   * When true, force the hover card closed and prevent it from opening on
   * hover. Use to defer to another surface anchored on the same trigger — e.g.
   * an editor popover that opens on click — so a click dismisses the hover card
   * instead of stacking it on top of the popover.
   */
  disabled?: boolean;
}>;

/**
 * @example
 * <HoverCard content={<span>Tooltip text</span>}>
 *   <button>Hover me</button>
 * </HoverCard>
 */
export function HoverCard(props: HoverCardProps) {
  // Controlled open: mirror Kobalte's hover-driven state via onOpenChange, then
  // gate it on `disabled` so the card hides immediately when suppressed — even
  // if it was already open when `disabled` flipped true.
  const [hovered, setHovered] = createSignal(false);
  const open = () => hovered() && !props.disabled;

  return (
    <Show when={!isTouchDevice()} fallback={props.children}>
      <KobalteTooltip
        open={open()}
        onOpenChange={setHovered}
        placement={props.placement ?? 'bottom'}
        overflowPadding={16}
        fitViewport={true}
        closeDelay={250}
        openDelay={250}
        flip={true}
        gutter={4}
      >
        <KobalteTooltip.Trigger
          class={cn('inline-flex items-center', props.triggerClass)}
          as={props.as ?? 'div'}
        >
          {props.children}
        </KobalteTooltip.Trigger>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content class="z-tool-tip max-w-[calc(100vw-32px)]">
            <Surface
              class={cn(
                'flex items-center justify-center p-2 text-ink-muted text-xs wrap-break-word',
                props.contentClass
              )}
              depth={3}
            >
              {props.content}
            </Surface>
          </KobalteTooltip.Content>
        </KobalteTooltip.Portal>
      </KobalteTooltip>
    </Show>
  );
}
