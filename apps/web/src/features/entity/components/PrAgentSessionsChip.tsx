import SparkleIcon from '@phosphor/sparkle.svg';
import { Button, cn, Dropdown } from '@ui';
import type { ParentProps } from 'solid-js';
import { rowPillTriggerClasses } from './row-pill';

function ChipLabel(props: { label: string }) {
  return (
    <>
      <SparkleIcon class="size-3 shrink-0 text-chat" aria-hidden="true" />
      <span data-pill-text class="min-w-0 truncate">
        {props.label}
      </span>
    </>
  );
}

export function PrAgentSessionChip(props: {
  label: string;
  disabled?: boolean;
  class?: string;
  onOpen: (event: MouseEvent) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      noTouchResize
      class={cn(rowPillTriggerClasses('max-w-48'), props.class)}
      title={props.label}
      label={`Open agent session: ${props.label}`}
      disabled={props.disabled}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      <ChipLabel label={props.label} />
    </Button>
  );
}

export function PrAgentSessionsCountChip(
  props: ParentProps<{
    count: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    class?: string;
  }>
) {
  const label = () => `${props.count} agent sessions`;
  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        variant="ghost"
        size="xs"
        noTouchResize
        class={cn(rowPillTriggerClasses('max-w-48'), props.class)}
        title={label()}
        label={`Show ${label()}`}
        onClick={(event: MouseEvent) => event.stopPropagation()}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ')
            event.stopPropagation();
        }}
      >
        <ChipLabel label={label()} />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-56 max-w-80"
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        <Dropdown.Group>
          <Dropdown.GroupLabel>Linked agent sessions</Dropdown.GroupLabel>
          {props.children}
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function PrAgentSessionMenuItem(props: {
  label: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <Dropdown.Item disabled={props.disabled} onSelect={props.onOpen}>
      <ChipLabel label={props.label} />
    </Dropdown.Item>
  );
}
