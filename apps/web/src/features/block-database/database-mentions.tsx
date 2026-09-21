import { UserIcon } from '@core/component/UserIcon';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import { createSignal, ErrorBoundary, Show, Suspense } from 'solid-js';
import type { DatabaseMentionPickerProps } from './component/GridCell';
import type { DatabaseEntityType } from './core/column-inference';
import { useDatabaseMentions } from './queries/database-mentions';
import {
  DatabaseMentionChoices,
  DatabaseMentionLabel,
  DatabaseMentionPlaceholder,
  DatabaseMentionPopover,
} from './views/database-mention-picker';

function MentionChoicesAdapter(props: DatabaseMentionPickerProps) {
  const [search, setSearch] = createSignal(props.search);
  const source = useDatabaseMentions(() => props.specificEntityType, search);
  return (
    <DatabaseMentionChoices
      {...props}
      source={source}
      search={search()}
      onSearchChange={(value) => {
        setSearch(value);
        props.onSearchChange?.(value);
      }}
    />
  );
}

/** Production source mounts inside the popover's local loading/error boundary. */
export function DatabaseMentionPicker(props: DatabaseMentionPickerProps) {
  return (
    <DatabaseMentionPopover {...props}>
      <MentionChoicesAdapter {...props} />
    </DatabaseMentionPopover>
  );
}

function ResolvedMentionValue(props: {
  id: string;
  entityType: DatabaseEntityType;
}) {
  const display = usePropertyEntityDisplay(
    () => props.id,
    () => props.entityType
  );
  return (
    <DatabaseMentionLabel
      entityType={props.entityType}
      name={display.name()}
      icon={
        <Show when={props.entityType === 'USER'} fallback={display.icon()}>
          <UserIcon id={props.id} size="sm" suppressClick showTooltip={false} />
        </Show>
      }
    />
  );
}

/** A label lookup must never suspend the surrounding grid or its active editor. */
export function DatabaseMentionValue(props: {
  id: string;
  entityType: DatabaseEntityType;
}) {
  const fallback = () => (
    <DatabaseMentionPlaceholder entityType={props.entityType} />
  );
  return (
    <ErrorBoundary fallback={fallback()}>
      <Suspense fallback={fallback()}>
        <ResolvedMentionValue {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
