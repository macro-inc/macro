import type { Placement } from '@floating-ui/dom';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { JSX, ParentProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

type HoverCardProps = ParentProps<{
  triggerClass?: string;
  contentClass?: string;
  placement?: Placement;
  content: JSX.Element;
  as?: 'div' | 'span';
}>;

/**
 * @example
 * <HoverCard content={<span>Tooltip text</span>}>
 *   <button>Hover me</button>
 * </HoverCard>
 */
export function HoverCard(props: HoverCardProps) {
  return (
    <KobalteTooltip
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
  );
}
