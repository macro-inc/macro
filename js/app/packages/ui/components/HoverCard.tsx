import { HoverCard as KobalteHoverCard } from '@kobalte/core/hover-card';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { Surface } from '@ui';

export type HoverCardProps = ParentProps<{
  content: JSX.Element;
  placement?: Placement;
  as?: 'div' | 'span';
}>;

/**
 * @example
 * <HoverCard content={<></>}>
 * </HoverCard>
 */
export function HoverCard(props: HoverCardProps) {
  return (
    <KobalteHoverCard
      placement={props.placement ?? 'bottom'}
      overflowPadding={16}
      fitViewport={true}
      closeDelay={250}
      openDelay={250}
      flip={true}
      gutter={4}
    >
      <KobalteHoverCard.Trigger
        class="inline-flex items-center"
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteHoverCard.Trigger>
      <KobalteHoverCard.Portal>
        <KobalteHoverCard.Content class="z-tool-tip max-w-[calc(100vw-32px)]">
          <Surface
            class="flex items-center justify-center p-2 text-ink-muted text-xs wrap-break-word"
            depth={3}
          >
            {props.content}
          </Surface>
        </KobalteHoverCard.Content>
      </KobalteHoverCard.Portal>
    </KobalteHoverCard>
  );
}
