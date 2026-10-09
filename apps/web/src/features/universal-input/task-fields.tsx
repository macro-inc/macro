import { InlinePropertyValue } from '@app/features/block-md/component/InlinePropertyValue';
import {
  createTaskComposerProperties,
  defaultTaskPropertyValues,
} from '@app/features/block-md/util/taskComposerProperties';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { For } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { parseTaskProperties } from './queries/task-properties';

export function TaskFields(props: {
  value: string;
  userId: string;
  onChange: (value: string) => void;
}) {
  const state = createTaskComposerProperties({
    initialValues: {
      ...defaultTaskPropertyValues([props.userId]),
      ...parseTaskProperties(props.value),
    },
  });
  const saveHandler: typeof state.saveHandler = {
    async saveProperty(property, value) {
      await state.saveHandler.saveProperty(property, value);
      props.onChange(JSON.stringify(unwrap(state.propertyValues)));
    },
    async saveDate(property, value) {
      await state.saveHandler.saveDate(property, value);
      props.onChange(JSON.stringify(unwrap(state.propertyValues)));
    },
  };
  return (
    <PropertiesProvider
      entityType="TASK"
      canEdit={true}
      properties={state.properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={saveHandler}
    >
      <div class="flex flex-wrap gap-2">
        <For
          each={state
            .properties()
            .filter(
              (p) => p.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE
            )}
        >
          {(property) => (
            <InlinePropertyValue
              property={property}
              emptyLabel={property.displayName}
            />
          )}
        </For>
      </div>
      <Modals />
    </PropertiesProvider>
  );
}
