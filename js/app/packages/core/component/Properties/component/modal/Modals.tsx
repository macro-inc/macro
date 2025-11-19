import { useBlockId } from '@core/block';
import { DatePicker } from '@core/component/DatePicker';
import { type Component, createMemo } from 'solid-js';
import { Portal, Show } from 'solid-js/web';
import { saveEntityPropertyWithToast } from '../../api';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { CreatePropertyModal } from './CreatePropertyModal';
import { EditPropertyValueModal } from './EditPropertyValueModal';
import { SelectPropertyModal } from './SelectPropertyModal';

export const Modals: Component = () => {
  const blockId = useBlockId();
  const {
    entityType,
    onPropertyAdded,
    properties,
    onRefresh,
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
    const success = await saveEntityPropertyWithToast(
      blockId,
      property,
      { valueType: 'DATE', value: newDate.toISOString() },
      entityType
    );
    if (success) {
      onRefresh();
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
          existingPropertyIds={existingPropertyIds()}
        />
      </Show>

      <Show when={propertyEditorModal()}>
        {(state) => {
          const position = state().anchor
            ? {
                top: state().anchor!.getBoundingClientRect().top,
                left: state().anchor!.getBoundingClientRect().left,
              }
            : undefined;

          return (
            <EditPropertyValueModal
              property={state().property}
              onClose={closePropertyEditor}
              onSaved={handlePropertySaved}
              position={position}
              entityType={entityType}
            />
          );
        }}
      </Show>

      <Show when={datePickerModal()}>
        {(state) => {
          const property = state().property;
          const dateValue =
            property.value !== null ? new Date(property.value) : new Date();
          const anchor = state().anchor;

          return anchor ? (
            <Portal>
              <DatePicker
                value={dateValue}
                onChange={(newDate) => handleDateSaved(newDate, property)}
                onClose={closeDatePicker}
                anchorRef={anchor}
              />
            </Portal>
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
