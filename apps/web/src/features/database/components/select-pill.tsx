import { TagDot } from '@property/tags/TagDot';
import { Badge } from '@ui';
import { Show } from 'solid-js';
import { type DatabaseViewColumn, optionOf } from '../core/database-view';

/** An option value drawn like a task's: tags and coloured options carry a dot. */
export function OptionPill(props: {
  label: string;
  color?: string | null;
  tag?: boolean;
  empty?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      size="xs"
      class="min-w-0 max-w-full"
      classList={{ 'text-ink-placeholder': props.empty }}
      title={props.label}
    >
      <Show when={!props.empty && (props.tag || props.color)}>
        <TagDot color={props.color ?? undefined} class="size-2" />
      </Show>
      <span class="truncate">{props.label}</span>
    </Badge>
  );
}

/** A grid column's option, with the colour the column stores for its label. */
export function SelectPill(props: {
  label: string;
  column?: DatabaseViewColumn;
  empty?: boolean;
}) {
  return (
    <OptionPill
      label={props.label}
      color={props.column && optionOf(props.column, props.label)?.color}
      tag={props.column?.dataType === 'TAG'}
      empty={props.empty}
    />
  );
}
