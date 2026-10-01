import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { Show, Suspense } from 'solid-js';
import type { ReminderEntity } from '../types/entity';

/** Attached reminders take their identity from the current, accessible source. */
export function ReminderTitle(props: {
  entity: ReminderEntity;
  showNote?: boolean;
}) {
  return (
    <Show
      when={props.entity.referencedEntity}
      fallback={<span class="truncate">{props.entity.name || 'Reminder'}</span>}
    >
      {(reference) => (
        <Suspense fallback={<span class="text-ink-muted">Loading…</span>}>
          <SourceTitle
            entity={props.entity}
            reference={reference()}
            showNote={props.showNote}
          />
        </Suspense>
      )}
    </Show>
  );
}

function SourceTitle(props: {
  entity: ReminderEntity;
  reference: NonNullable<ReminderEntity['referencedEntity']>;
  showNote?: boolean;
}) {
  const [item] = useItemPreview(() => ({
    id: props.reference.id,
    type: props.reference.type,
  }));
  const title = () => {
    const source = item();
    if (source.loading) return 'Loading…';
    if (isAccessiblePreviewItem(source)) return source.name;
    return `Unavailable ${props.reference.subType === 'task' ? 'task' : props.reference.type.replaceAll('_', ' ')}`;
  };
  const note = () =>
    props.entity.description.trim() !== title().trim()
      ? props.entity.description
      : undefined;
  return (
    <span class="flex min-w-0 flex-col justify-center">
      <span class="truncate" title={title()}>
        {title()}
      </span>
      <Show when={props.showNote && note()}>
        {(text) => (
          <span class="truncate text-xs font-normal text-ink-muted">
            {text()}
          </span>
        )}
      </Show>
    </span>
  );
}
