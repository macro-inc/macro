import SparkleIcon from '@phosphor/sparkle.svg';
import { Button, cn, Dropdown } from '@ui';
import type { ParentProps } from 'solid-js';

function ChipLabel(props: { label: string }) {
  return (
    <>
      <SparkleIcon class="size-3 shrink-0 text-chat" aria-hidden="true" />
      <span class="min-w-0 truncate">{props.label}</span>
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
      class={cn(
        'h-auto min-w-0 max-w-48 gap-1.5 rounded-full border-edge bg-surface/50 px-1.5 py-1 text-xs font-medium leading-tight text-ink-muted',
        props.class
      )}
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
        class={cn(
          'h-auto min-w-0 max-w-48 gap-1.5 rounded-full border-edge bg-surface/50 px-1.5 py-1 text-xs font-medium leading-tight text-ink-muted',
          props.class
        )}
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
