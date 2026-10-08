import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Suspense } from 'solid-js';
import { match } from 'ts-pattern';

type ScopeProps = {
  kind: 'CHANNEL' | 'DOCUMENT' | 'TASK' | 'THREAD';
  ids?: string[];
};

function entityLabel(kind: ScopeProps['kind']) {
  return match(kind)
    .with('CHANNEL', () => 'channel')
    .with('DOCUMENT', () => 'document')
    .with('TASK', () => 'task')
    .with('THREAD', () => 'email thread')
    .exhaustive();
}

export function RoutineEventScopeLabel(props: ScopeProps) {
  const entities = useQuickAccessEntities(() => props.kind);
  const label = () => {
    const singular = entityLabel(props.kind);
    if (props.kind === 'THREAD' && props.ids === undefined) return 'Your inbox';
    if (props.ids === undefined) return `Any ${singular}`;
    if (!props.ids.length) return `Choose ${singular}s`;
    if (props.ids.length > 1) return `${props.ids.length} ${singular}s`;
    const entity = entities.items().find((item) => item.id === props.ids?.[0]);
    return entity?.data.name ?? `Selected ${singular}`;
  };
  return <span title={label()}>{label()}</span>;
}

/** Inline search inside the trigger panel; never opens another popover. */
export function RoutineEventScope(
  props: ScopeProps & {
    onChange: (ids: string[] | undefined) => void;
  }
) {
  const plural = () => `${entityLabel(props.kind)}s`;
  return (
    <Suspense fallback={<p class="p-3 text-sm text-ink-muted">Loading…</p>}>
      <PropertyEntitySelector
        config={{
          isMultiSelect: true,
          placeholder: `Search ${plural()}…`,
          specificEntityType: props.kind,
        }}
        selectedOptions={() => new Set(props.ids ?? ['__any__'])}
        setSelectedOptions={(ids) => {
          if (ids.has('__any__') && props.ids !== undefined) {
            props.onChange(undefined);
          } else {
            props.onChange([...ids].filter((id) => id !== '__any__'));
          }
        }}
        pinnedOptions={[
          {
            id: '__any__',
            label: `Any ${entityLabel(props.kind)} I can access`,
          },
        ]}
      />
    </Suspense>
  );
}
