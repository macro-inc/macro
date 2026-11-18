import { PropertyValueIcon } from '@property/component/propertyValue';
import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { formatOptionValue } from '@property/utils/formatting';
import { usePropertyOptionsQuery } from '@queries/properties/options';
import { Button, Tabs } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import type { TaskTriggerProperty } from './core/routine-triggers';
import { RoutineEntityPicker } from './routine-event-scope';

type OptionProperty = Extract<TaskTriggerProperty, { kind: 'options' }>;
type EntityProperty = Extract<TaskTriggerProperty, { kind: 'entities' }>;

/** The property's options, without suspending the panel while they load. */
function usePropertyOptions(definitionId: () => string | undefined) {
  const query = usePropertyOptionsQuery(
    () => definitionId() ?? '',
    () => definitionId() !== undefined
  );
  return {
    options: () => (query.isSuccess ? query.data : []),
    failed: () => query.isError,
  };
}

function OptionValues(props: {
  property: OptionProperty;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const options = usePropertyOptions(() => props.property.definitionId);
  const toggle = (id: string) =>
    props.onChange(
      props.values.includes(id)
        ? props.values.filter((value) => value !== id)
        : [...props.values, id]
    );
  return (
    <>
      <div class="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={props.values.length === 0}
          onClick={() => props.onChange([])}
        >
          {props.property.anyLabel}
        </Button>
        <For each={options.options()}>
          {(option) => (
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={props.values.includes(option.id)}
              onClick={() => toggle(option.id)}
            >
              <PropertyValueIcon optionId={option.id} class="size-3.5" />
              {formatOptionValue(option)}
            </Button>
          )}
        </For>
      </div>
      <Show when={options.failed()}>
        <p class="text-xs text-failure">These values couldn’t be loaded.</p>
      </Show>
    </>
  );
}

function EntityValues(props: {
  property: EntityProperty;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [specific, setSpecific] = createSignal(props.values.length > 0);
  return (
    <>
      <Tabs
        aria-label="Changes to"
        size="sm"
        fullWidth
        options={[
          { value: 'any', label: props.property.anyLabel },
          { value: 'specific', label: props.property.specificLabel },
        ]}
        value={specific() ? 'specific' : 'any'}
        onChange={(value) => {
          setSpecific(value === 'specific');
          if (value === 'any') props.onChange([]);
        }}
      />
      <Show when={specific()}>
        <RoutineEntityPicker
          entityType={props.property.entityType}
          placeholder={props.property.placeholder}
          ids={props.values}
          onChange={props.onChange}
        />
      </Show>
    </>
  );
}

/** Which values of a task property start the routine. */
export function RoutineEventPropertyValues(props: {
  property: TaskTriggerProperty;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const optionProperty = () =>
    props.property.kind === 'options' ? props.property : undefined;
  const entityProperty = () =>
    props.property.kind === 'entities' ? props.property : undefined;
  return (
    <Show when={props.property.kind !== 'none'}>
      <div class="mb-3 grid gap-1.5">
        <span class="text-xs font-medium">Changes to</span>
        <Switch>
          <Match when={optionProperty()}>
            {(property) => (
              <OptionValues
                property={property()}
                values={props.values}
                onChange={props.onChange}
              />
            )}
          </Match>
          <Match when={entityProperty()}>
            {(property) => (
              <EntityValues
                property={property()}
                values={props.values}
                onChange={props.onChange}
              />
            )}
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

/** The chosen values on a trigger's chip, such as "Completed · ". */
export function RoutineEventValueLabel(props: {
  property: TaskTriggerProperty;
  values: string[];
}) {
  const options = usePropertyOptions(() =>
    props.property.kind === 'options' ? props.property.definitionId : undefined
  );
  const entities = useQuickAccessEntities(() =>
    props.property.kind === 'entities' ? props.property.entityType : null
  );
  const valueName = (id: string) => {
    const option = options.options().find((item) => item.id === id);
    if (option) return formatOptionValue(option);
    return entities.items().find((item) => item.id === id)?.data.name;
  };
  const label = () => {
    if (props.values.length > 2) return `${props.values.length} values`;
    const names = props.values.map(valueName);
    return names.every(Boolean)
      ? names.join(' or ')
      : `${props.values.length} selected`;
  };
  return <Show when={props.values.length}>{label()} · </Show>;
}
