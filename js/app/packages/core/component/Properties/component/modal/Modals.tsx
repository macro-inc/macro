import { type Component, createMemo } from 'solid-js';
import { Show } from 'solid-js/web';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { CreatePropertyModal } from './CreatePropertyModal';
import { EditPropertyValueModal } from './EditPropertyValueModal';
import { SelectPropertyModal } from './SelectPropertyModal';

export const Modals: Component = () => {
  const {
    entityType,
    onPropertyAdded,
    properties,
    onRefresh,
    propertySelectorModal,
    propertyEditorModal,
    createPropertyModal,
    closePropertySelector,
    closePropertyEditor,
    closeCreateProperty,
  } = usePropertiesContext();

  const existingPropertyIds = createMemo(() => {
    return properties().map((prop) => prop.propertyDefinitionId);
  });

  const handlePropertySaved = () => {
    onRefresh();
    closePropertyEditor();
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
