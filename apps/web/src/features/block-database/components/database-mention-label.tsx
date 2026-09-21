import { Tooltip } from '@ui/components/Tooltip';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import type { DatabaseEntityType } from '../core/column-inference';

function mentionTypeLabel(type: DatabaseEntityType): string {
  return match(type)
    .with('USER', () => 'Person')
    .with('DOCUMENT', () => 'Document')
    .with('TASK', () => 'Task')
    .with('CHANNEL', () => 'Channel')
    .with('PROJECT', () => 'Project')
    .with('CHAT', () => 'Chat')
    .with('THREAD', () => 'Email')
    .with('COMPANY', () => 'Company')
    .with('CALL_RECORD', () => 'Call')
    .with('CALENDAR_EVENT', () => 'Event')
    .exhaustive();
}

export function DatabaseMentionLabel(props: {
  name: string;
  icon: JSX.Element;
  entityType: DatabaseEntityType;
}) {
  return (
    <Tooltip
      as="span"
      label={props.name || mentionTypeLabel(props.entityType)}
      class="min-w-0 max-w-full"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span
          class="pointer-events-none flex size-4 shrink-0 items-center"
          aria-hidden="true"
        >
          {props.icon}
        </span>
        <span class="truncate">
          {props.name || mentionTypeLabel(props.entityType)}
        </span>
      </span>
    </Tooltip>
  );
}

export function DatabaseMentionPlaceholder(props: {
  entityType: DatabaseEntityType;
}) {
  return (
    <span class="truncate text-ink-muted">
      {mentionTypeLabel(props.entityType)}
    </span>
  );
}
