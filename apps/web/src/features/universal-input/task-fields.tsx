import { InlinePropertyValue } from '@app/features/block-md/component/InlinePropertyValue';
import { createTaskComposerProperties } from '@app/features/block-md/util/taskComposerProperties';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { PropertyApiValues } from '@property/types';
import { EntityComposer } from '@ui';
import { For } from 'solid-js';
import { parseTaskProperties } from './queries/task-properties';

export function TaskFields(props: {
  disabled?: boolean;
  value: string;
  values: Record<string, PropertyApiValues>;
  onChange: (value: string) => void;
}) {
  const state = createTaskComposerProperties({
    initialValues: {},
    values: () => props.values,
    additionalPropertyIds: () => Object.keys(props.values),
  });
  const saveHandler: typeof state.saveHandler = {
    async saveProperty(property, value) {
      props.onChange(
        JSON.stringify({
          ...parseTaskProperties(props.value),
          [property.propertyDefinitionId]: value,
        })
      );
    },
    async saveDate(property, value) {
      props.onChange(
        JSON.stringify({
          ...parseTaskProperties(props.value),
          [property.propertyDefinitionId]: { valueType: 'DATE', value },
        })
      );
    },
  };
  return (
    <PropertiesProvider
      entityType="TASK"
      canEdit={!props.disabled}
      properties={state.properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={saveHandler}
    >
      <EntityComposer.Properties>
        <For each={state.properties()}>
          {(property) => (
            <InlinePropertyValue
              property={property}
              emptyLabel={property.displayName}
            />
          )}
        </For>
      </EntityComposer.Properties>
      <Modals />
    </PropertiesProvider>
  );
}
