import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { PropertyEditorDialog } from '@property/editor/PropertyEditorModal';
import type { PropertyEditorState } from '@property/editor/state/propertyEditor';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

/** Use the same property flow as the side panel, with writes owned by the draft. */
export function TaskComposerPropertyEditor(props: {
  name: string;
  definitions: PropertyDefinitionDomain[];
  properties: Property[];
  onAdd: (id: string, created?: PropertyDefinitionWithOptions) => Promise<void>;
  onSave: (id: string, value: PropertyApiValues) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createStore<PropertyEditorState>({
    mode: 'selector',
    selectedEntities: [],
  });
  const close = () => {
    setOpen(false);
    setState({ mode: 'selector', targetProperty: undefined });
  };

  return (
    <>
      <AddPropertyButton onClick={() => setOpen(true)} />
      <Show when={open()}>
        <PropertyEditorDialog
          isOpen={open()}
          state={state}
          onModeChange={(mode) => setState('mode', mode)}
          onTargetChange={(property) => setState('targetProperty', property)}
          onClose={close}
          onPropertyAdded={async (ids) => {
            for (const id of ids ?? []) await props.onAdd(id);
          }}
          onPropertyCreated={(created) =>
            props.onAdd(created.definition.id, created)
          }
          onSave={(property, value) =>
            props.onSave(
              'propertyDefinitionId' in property
                ? property.propertyDefinitionId
                : property.id,
              value
            )
          }
          availableProperties={props.definitions}
          properties={props.properties}
          name={props.name || 'New task'}
        />
      </Show>
    </>
  );
}
