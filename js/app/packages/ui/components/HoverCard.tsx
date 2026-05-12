import { HoverCard as KobalteHoverCard } from '@kobalte/core/hover-card';
import type { Placement } from '@floating-ui/dom';
import type { ParentProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

type TriggerProps = ParentProps<{ as?: 'div' | 'span'; class?: string }>;

type RootProps = ParentProps<{ placement?: Placement }>;

type ContentProps = ParentProps<{ class?: string }>;

/*
<HoverCard>
  <HoverCard.Trigger></HoverCard.Trigger>
  <HoverCard.Content></HoverCard.Content>
</HoverCard>
*/

function HoverCardRoot(props: RootProps) {
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
      {props.children}
    </KobalteHoverCard>
  );
}

function HoverCardTrigger(props: TriggerProps) {
  return (
    <KobalteHoverCard.Trigger
      class={cn('inline-flex items-center', props.class)}
      as={props.as ?? 'div'}
    >
      {props.children}
    </KobalteHoverCard.Trigger>
  );
}

function HoverCardContent(props: ContentProps) {
  return (
    <KobalteHoverCard.Portal>
      <KobalteHoverCard.Content class="z-tool-tip max-w-[calc(100vw-32px)]">
        <Surface
          class={cn(
            'flex items-center justify-center p-2 text-ink-muted text-xs wrap-break-word',
            props.class,
          )}
          depth={3}
        >
          {props.children}
        </Surface>
      </KobalteHoverCard.Content>
    </KobalteHoverCard.Portal>
  );
}

export const HoverCard = Object.assign(HoverCardRoot, {
  Trigger: HoverCardTrigger,
  Content: HoverCardContent,
});
