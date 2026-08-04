import { type Component, createEffect, createSignal } from 'solid-js';
import { Show } from 'solid-js/web';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { CreatePropertyModal } from './CreatePropertyModal';

export const Modals: Component = () => {
  const {
    onPropertyAdded,
    properties,
    createPropertyModal,
    closeCreateProperty,
    onPropertyPinned,
  } = usePropertiesContext();

  const [pendingPinDefinitionId, setPendingPinDefinitionId] = createSignal<
    string | null
  >(null);

  // Effect to pin property after it's been added and appears in the list
  createEffect(() => {
    const definitionId = pendingPinDefinitionId();
    if (!definitionId || !onPropertyPinned) return;

    const addedProperty = properties().find(
      (p) => p.propertyDefinitionId === definitionId
    );

    if (addedProperty) {
      onPropertyPinned(addedProperty.propertyId);
      setPendingPinDefinitionId(null);
    }
  });

  const handlePropertyCreated = (propertyDefinitionId?: string) => {
    if (propertyDefinitionId) {
      onPropertyAdded([propertyDefinitionId]);
      setPendingPinDefinitionId(propertyDefinitionId);
    } else {
      onPropertyAdded();
    }
    closeCreateProperty();
  };

  return (
    <Show when={createPropertyModal()}>
      {(state) => (
        <CreatePropertyModal
          isOpen={true}
          onClose={closeCreateProperty}
          onPropertyCreated={handlePropertyCreated}
          autoPinOnCreate={state().autoPinOnCreate}
          initialName={state().initialName}
        />
      )}
    </Show>
  );
};
