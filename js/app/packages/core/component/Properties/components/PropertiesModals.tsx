import { useBlockId } from '@core/block';
import { DatePicker } from '@core/component/DatePicker';
import { type Component, createMemo } from 'solid-js';
import { Portal, Show } from 'solid-js/web';
import { savePropertyValue } from '../apiUtils';
import { usePropertiesContext } from '../context/PropertiesContext';
import { PropertyEditor } from '../PropertyEditor';
import { PropertySelector } from '../PropertySelector';
import type { Property } from '../types';
import { CreatePropertyModal } from './CreatePropertyModal';

export const PropertiesModals: Component = () => {
  const blockId = useBlockId();
  const {
    entityType,
    onPropertyAdded,
    properties,
    onRefresh,
    closeModal,
    isModalOpen,
    getModalData,
    getModalAnchor,
  } = usePropertiesContext();

  const existingPropertyIds = createMemo(() => {
    return properties().map((prop) => prop.propertyDefinitionId);
  });

  const handlePropertyAdded = () => {
    onPropertyAdded();
    closeModal();
  };

  const handlePropertySaved = () => {
    onRefresh();
    closeModal();
  };

  return (
    <>
      <Show when={isModalOpen('add-property')}>
        <PropertySelector
          isOpen={true}
          onClose={closeModal}
          existingPropertyIds={existingPropertyIds()}
        />
      </Show>

      <Show when={isModalOpen('edit-property') && getModalData()}>
        {(property) => {
          const anchor = getModalAnchor();
          const position = anchor
            ? {
                top: anchor.getBoundingClientRect().top,
                left: anchor.getBoundingClientRect().left,
              }
            : undefined;

          return (
            <PropertyEditor
              property={property() as Property}
              onClose={closeModal}
              onSaved={handlePropertySaved}
              position={position}
              entityType={entityType}
            />
          );
        }}
      </Show>

      <Show
        when={isModalOpen('date-picker') && getModalAnchor() && getModalData()}
      >
        {(modalData) => {
          const property = modalData() as Property;
          const dateValue =
            property.valueType === 'DATE' && property.value
              ? new Date(property.value)
              : new Date();

          return (
            <Portal>
              <DatePicker
                value={dateValue}
                onChange={async (newDate) => {
                  const success = await savePropertyValue(
                    blockId,
                    property,
                    { valueType: 'DATE', value: newDate.toISOString() },
                    entityType
                  );
                  if (success) {
                    onRefresh();
                  }
                  closeModal();
                }}
                onClose={closeModal}
                anchorRef={getModalAnchor()!}
              />
            </Portal>
          );
        }}
      </Show>

      <Show when={isModalOpen('create-property')}>
        <CreatePropertyModal
          isOpen={true}
          onClose={closeModal}
          onPropertyCreated={handlePropertyAdded}
        />
      </Show>
    </>
  );
};
