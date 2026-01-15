import { DatePicker } from '@core/component/DatePicker';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { type Component, createMemo } from 'solid-js';
import { Show } from 'solid-js/web';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { CreatePropertyModal } from './CreatePropertyModal';
import { EditPropertyValueModal } from './EditPropertyValueModal';
import { SelectPropertyModal } from './SelectPropertyModal';

export const Modals: Component = () => {
  const {
    entityType,
    onPropertyAdded,
    properties,
    onRefresh,
    saveHandler,
    propertySelectorModal,
    propertyEditorModal,
    datePickerModal,
    createPropertyModal,
    closePropertySelector,
    closePropertyEditor,
    closeDatePicker,
    closeCreateProperty,
  } = usePropertiesContext();

  const existingPropertyIds = createMemo(() => {
    return properties().map((prop) => prop.propertyDefinitionId);
  });

  const handlePropertySaved = () => {
    onRefresh();
    closePropertyEditor();
  };

  const handleDateSaved = async (newDate: Date, property: Property) => {
    try {
      await saveHandler.saveDate(property, newDate);
      onRefresh();
    } catch (error) {
      console.error('Failed to save date property:', error);
    }
    closeDatePicker();
  };

  const handlePropertyCreated = () => {
    onPropertyAdded();
    closeCreateProperty();
  };

  return (
    <>
      <Show when={propertySelectorModal()}>
        <SelectPropertyModal
          isOpen={true}
          onClose={closePropertySelector}
          existingPropertyIds={existingPropertyIds}
        />
      </Show>

      <Show when={propertyEditorModal()}>
        {(state) => (
          <EditPropertyValueModal
            property={state().property}
            onClose={closePropertyEditor}
            onSaved={handlePropertySaved}
            anchorRef={state().anchor ?? undefined}
            entityType={entityType}
          />
        )}
      </Show>

      <Show when={datePickerModal()}>
        {(state) => {
          const property = state().property;
          const dateValue =
            property.value != null ? new Date(property.value) : new Date();
          const anchor = state().anchor;

          return anchor ? (
            <ScopedPortal scope="local">
              <DatePicker
                value={dateValue}
                onChange={(newDate) => handleDateSaved(newDate, property)}
                onClose={closeDatePicker}
                anchorRef={anchor}
              />
            </ScopedPortal>
          ) : null;
        }}
      </Show>

      <Show when={createPropertyModal()}>
        <CreatePropertyModal
          isOpen={true}
          onClose={closeCreateProperty}
          onPropertyCreated={handlePropertyCreated}
        />
      </Show>
    </>
  );
};
