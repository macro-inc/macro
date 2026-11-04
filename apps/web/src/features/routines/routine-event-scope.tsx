import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Tabs } from '@ui';
import { Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import {
  callEventScopeLabel,
  type RoutineEventName,
} from './core/routine-triggers';

type ScopeProps = {
  kind: 'CHANNEL' | 'DOCUMENT' | 'TASK' | 'THREAD' | 'CALL_RECORD';
  ids?: string[];
  events?: readonly RoutineEventName[];
};

function entityLabel(kind: ScopeProps['kind']) {
  return match(kind)
    .with('CHANNEL', () => 'channel')
    .with('DOCUMENT', () => 'document')
    .with('TASK', () => 'task')
    .with('THREAD', () => 'email thread')
    .with('CALL_RECORD', () => 'call')
    .exhaustive();
}

export function RoutineEventScopeLabel(props: ScopeProps) {
  const entities = useQuickAccessEntities(() => props.kind);
  const label = () => {
    const singular = entityLabel(props.kind);
    if (props.kind === 'THREAD' && props.ids === undefined) return 'Your inbox';
    if (props.kind === 'CALL_RECORD' && props.ids === undefined)
      return callEventScopeLabel(props.events ?? ['call.ended']);
    if (props.ids === undefined) return `Any ${singular}`;
    if (!props.ids.length) return `Choose ${singular}s`;
    if (props.ids.length > 1) return `${props.ids.length} ${singular}s`;
    const entity = entities.items().find((item) => item.id === props.ids?.[0]);
    return entity?.data.name ?? `Selected ${singular}`;
  };
  return <span title={label()}>{label()}</span>;
}

/** Inline search inside the trigger panel; never opens another popover. */
export function RoutineEntityPicker(props: {
  entityType: ScopeProps['kind'] | 'USER' | 'INITIATIVE';
  placeholder: string;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <Suspense fallback={<p class="p-3 text-sm text-ink-muted">Loading…</p>}>
      <div class="overflow-hidden rounded-lg border border-edge-muted">
        <PropertyEntitySelector
          config={{
            isMultiSelect: true,
            placeholder: props.placeholder,
            specificEntityType: props.entityType,
            visibleCheckboxes: true,
          }}
          selectedOptions={() => new Set(props.ids)}
          setSelectedOptions={(ids) => props.onChange([...ids])}
        />
      </div>
    </Suspense>
  );
}

export function RoutineEventScope(
  props: ScopeProps & {
    onChange: (ids: string[] | undefined) => void;
  }
) {
  const singular = () => entityLabel(props.kind);
  return (
    <div class="grid gap-1.5">
      <span class="text-xs font-medium">Applies to</span>
      <Tabs
        aria-label="Applies to"
        size="sm"
        fullWidth
        options={[
          { value: 'any', label: `Any ${singular()}` },
          { value: 'specific', label: `Specific ${singular()}s` },
        ]}
        value={props.ids === undefined ? 'any' : 'specific'}
        onChange={(value) => props.onChange(value === 'any' ? undefined : [])}
      />
      <Show
        when={props.ids}
        fallback={
          <p class="text-xs text-ink-muted">
            Every {singular()} you can access.
          </p>
        }
      >
        {(ids) => (
          <RoutineEntityPicker
            entityType={props.kind}
            placeholder={`Search ${singular()}s…`}
            ids={ids()}
            onChange={props.onChange}
          />
        )}
      </Show>
    </div>
  );
}
