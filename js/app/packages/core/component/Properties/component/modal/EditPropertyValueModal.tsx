import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { mergeRefs } from '@solid-primitives/refs';
import { createSignal, onMount, Show } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { usePropertyEditor } from '../../hooks/usePropertyEditor';
import type { PropertyApiValues, PropertyEditorProps } from '../../types';

false && floatWithElement;
import {
  entityReferencesToIdSet,
  updateEntityReferences,
} from '../../utils/entityConversion';
import { PropertyEntitySelector } from './shared/PropertyEntitySelector';
import { PropertyOptionSelector } from './shared/PropertyOptionSelector';
import { PropertyDateSelector } from './shared/PropertyDateSelector';
import {
  useAddPropertyOptionMutation,
  usePropertyOptionsQuery,
} from '@queries/properties/options';
import type { DateProperty } from '../../types';

// Common CSS classes
const MODAL_BASE =
  'absolute z-action-menu bg-menu border border-edge-muted max-h-96 overflow-hidden flex flex-col w-full max-w-sm';

export function EditPropertyValueModal(props: PropertyEditorProps) {
  const propertyOptionsQuery = usePropertyOptionsQuery(
    () => props.property.propertyDefinitionId
  );

  const addPropertyOptionMutation = useAddPropertyOptionMutation({});

  const propertyOptions = () => {
    if (
      propertyOptionsQuery.isLoading ||
      propertyOptionsQuery.isError ||
      !propertyOptionsQuery.data
    )
      return [];
    return propertyOptionsQuery.data;
  };

  const isLoading = () =>
    propertyOptionsQuery.isLoading || addPropertyOptionMutation.isPending;

  const { saveHandler } = usePropertiesContext();

  let modalRef!: HTMLDivElement;

  const [attachHotkeys, modalScopeId] = useHotkeyDOMScope(
    'property-edit-modal',
    false
  );

  const [selectedEntityRefs, setSelectedEntityRefs] = createSignal<
    EntityReference[]
  >(
    props.property.valueType === 'ENTITY' && props.property.value != null
      ? props.property.value
      : []
  );

  const [selectedDate, setSelectedDate] = createSignal<Date | null>(
    props.property.valueType === 'DATE' && props.property.value != null
      ? new Date(props.property.value)
      : null
  );

  const {
    selectedOptions,
    hasChanges,
    initializeSelectedOptions,
    toggleOption,
    addOption,
  } = usePropertyEditor(
    props.property,
    propertyOptions,
    addPropertyOptionMutation.mutateAsync
  );

  const saveChanges = async () => {
    const selectedArray = Array.from(selectedOptions());

    let apiValues: PropertyApiValues;

    switch (props.property.valueType) {
      case 'SELECT_STRING':
        apiValues = {
          valueType: 'SELECT_STRING',
          values: selectedArray.length > 0 ? selectedArray : null,
        };
        break;
      case 'SELECT_NUMBER':
        apiValues = {
          valueType: 'SELECT_NUMBER',
          values: selectedArray.length > 0 ? selectedArray : null,
        };
        break;
      case 'ENTITY': {
        const refs = selectedEntityRefs();
        apiValues = {
          valueType: 'ENTITY',
          refs: refs.length > 0 ? refs : null,
        };
        break;
      }
      case 'DATE': {
        const date = selectedDate();
        apiValues = {
          valueType: 'DATE',
          value: date,
        };
        break;
      }
      default:
        console.error(
          'PropertyEditor.saveChanges:',
          new Error(
            `Invalid property type for modal editor: ${props.property.valueType}`
          )
        );
        props.onClose();
        return;
    }

    try {
      await saveHandler.saveProperty(props.property, apiValues);
      props.onSaved();
    } catch (error) {
      console.error('Failed to save property:', error);
    }

    props.onClose();
  };

  const hasEntityChanges = () => {
    if (props.property.valueType !== 'ENTITY') return false;

    const currentRefs = selectedEntityRefs();
    const originalRefs = props.property.value ?? [];

    // Compare lengths first
    if (currentRefs.length !== originalRefs.length) return true;

    // Compare each reference
    return !currentRefs.every((currentRef) =>
      originalRefs.some(
        (originalRef) =>
          originalRef.entity_id === currentRef.entity_id &&
          originalRef.entity_type === currentRef.entity_type
      )
    );
  };

  const hasDateChanges = () => {
    if (props.property.valueType !== 'DATE') return false;

    const currentDate = selectedDate();
    const originalDate = props.property.value
      ? new Date(props.property.value)
      : null;

    if (!currentDate && !originalDate) return false;

    if (!currentDate || !originalDate) return true;

    return currentDate.getTime() !== originalDate.getTime();
  };

  const handleClose = async () => {
    const hasUnsavedChanges =
      hasChanges() || hasEntityChanges() || hasDateChanges();
    if (hasUnsavedChanges) {
      await saveChanges();
    } else {
      props.onClose();
    }
  };

  onMount(() => {
    initializeSelectedOptions();
    propertyOptionsQuery.refetch();

    // Attach hotkeys to modal element
    attachHotkeys(modalRef);

    // Register escape key handler
    registerHotkey({
      hotkey: 'escape',
      scopeId: modalScopeId,
      description: 'Close property modal',
      keyDownHandler: () => {
        handleClose();
        return true;
      },
      runWithInputFocused: true,
    });
  });

  return (
    <ScopedPortal scope="local">
      <div class="fixed inset-0 z-modal" onClick={handleClose}>
        <div
          ref={mergeRefs((ref) => {
            modalRef = ref;
          })}
          class={MODAL_BASE}
          tabIndex={-1}
          use:floatWithElement={{ element: () => props.anchorRef }}
          // All properties that reach this modal (select, entity, and date types) should auto-save
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={!isLoading()}>
            <div class="bg-dialog text-ink">
              <div>
                <Show
                  when={
                    props.property.valueType === 'SELECT_STRING' ||
                    props.property.valueType === 'SELECT_NUMBER'
                  }
                  fallback={
                    <Show
                      when={props.property.valueType === 'ENTITY'}
                      fallback={
                        <Show when={props.property.valueType === 'DATE'}>
                          <PropertyDateSelector
                            property={props.property as DateProperty}
                            selectedDate={selectedDate()}
                            onSelectDate={(date) => setSelectedDate(date)}
                            onClose={handleClose}
                          />
                        </Show>
                      }
                    >
                      <PropertyEntitySelector
                        property={props.property}
                        selectedOptions={() => {
                          const refs = selectedEntityRefs();
                          return entityReferencesToIdSet(refs);
                        }}
                        setSelectedOptions={(newOptions, entityInfo) => {
                          const currentRefs = selectedEntityRefs();
                          const updatedRefs = updateEntityReferences(
                            currentRefs,
                            newOptions,
                            entityInfo
                          );
                          setSelectedEntityRefs(updatedRefs);
                        }}
                        setHasChanges={() => {}} // Not needed with new hook
                        onClose={handleClose}
                      />
                    </Show>
                  }
                >
                  <PropertyOptionSelector
                    property={props.property}
                    options={propertyOptions()}
                    isLoading={false}
                    error={null}
                    selectedOptions={selectedOptions}
                    onToggleOption={toggleOption}
                    onAddOption={
                      props.property.isSystemProperty ? undefined : addOption
                    }
                    onClose={handleClose}
                  />
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </ScopedPortal>
  );
}
