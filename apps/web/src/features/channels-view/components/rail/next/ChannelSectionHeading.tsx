import { CollapsibleSection } from '@app/components/view-shell';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Shared heading for built-in and custom Chat sections. */
export function ChannelSectionHeading(props: {
  id: string;
  label: string;
  title?: string;
  open: boolean;
  focused: boolean;
  unreadCount: number;
  onToggle: () => void;
  badge?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onToggle}
      class="pt-2"
    >
      <CollapsibleSection.Header
        class={cn('rounded-lg pr-0', props.focused && 'bg-hover text-ink')}
      >
        <CollapsibleSection.Trigger
          id={props.id}
          role="treeitem"
          tabIndex={-1}
          title={props.title}
          class={cn('flex-1', props.focused && 'text-ink')}
        >
          <span class="min-w-0 truncate">{props.label}</span>
          {props.badge}
          <CollapsibleSection.Indicator />
          <Show when={props.unreadCount > 0}>
            <span class="text-xs text-accent">{props.unreadCount}</span>
          </Show>
        </CollapsibleSection.Trigger>
        <div class="flex shrink-0 items-center">{props.children}</div>
      </CollapsibleSection.Header>
    </CollapsibleSection.Root>
  );
}
