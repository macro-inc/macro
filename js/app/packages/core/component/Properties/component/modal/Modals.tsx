import { DatePicker } from '@core/component/DatePicker';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { type Component, createMemo } from 'solid-js';
import { Show } from 'solid-js/web';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { CreatePropertyModal } from './CreatePropertyModal';
import { EditPropertyValueModal } from './EditPropertyValueModal';
import { SelectPropertyModal } from './SelectPropertyModal';
import { KeyboardDatePicker } from '@core/component/KeyboardDatePicker';

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
