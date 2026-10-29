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
    .with('INITIATIVE', () => 'Project')
    .with('CHAT', () => 'Chat')
    .with('THREAD', () => 'Email')
    .with('COMPANY', () => 'Company')
    .with('CONTACT', () => 'Contact')
    .with('CALL_RECORD', () => 'Call')
    .with('CALENDAR_EVENT', () => 'Event')
    .with('DATABASE_ROW', () => 'Row')
    .exhaustive(() => 'Item');
}

/** The search box placeholder for a reference column, named for what it links. */
export function mentionSearchLabel(type?: DatabaseEntityType | null): string {
  if (!type) return 'Search';
  return match(type)
    .with('USER', () => 'Search people')
    .with('DOCUMENT', () => 'Search documents')
    .with('TASK', () => 'Search tasks')
    .with('CHANNEL', () => 'Search channels')
    .with('PROJECT', 'INITIATIVE', () => 'Search projects')
    .with('CHAT', () => 'Search chats')
    .with('THREAD', () => 'Search emails')
    .with('COMPANY', () => 'Search companies')
    .with('CONTACT', () => 'Search contacts')
    .with('CALL_RECORD', () => 'Search calls')
    .with('CALENDAR_EVENT', () => 'Search events')
    .with('DATABASE_ROW', () => 'Search rows')
    .exhaustive(() => 'Search');
}

export function DatabaseMentionLabel(props: {
  name: string;
  icon: JSX.Element;
  entityType: DatabaseEntityType;
}) {
  // A native title shows the whole of a cut-off name; a styled tooltip in
  // every cell of a column costs a Kobalte root each.
  return (
    <span
      class="inline-flex min-w-0 max-w-full items-center"
      title={props.name || mentionTypeLabel(props.entityType)}
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
    </span>
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
