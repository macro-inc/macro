import { useBlockId } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import {
  constrainModalToViewport,
  MODAL_VIEWPORT_CLASSES,
} from '@core/util/modalUtils';
import XIcon from '@icon/regular/x.svg';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { savePropertyValue } from '../../api/propertyValues';
import { MODAL_DIMENSIONS } from '../../constants';
import { usePropertyEditor } from '../../hooks/usePropertyModals';
import type { PropertyApiValues, PropertyEditorProps } from '../../types';
import { getValueTypeDisplay } from '../../utils';
import {
  entityReferencesToIdSet,
  updateEntityReferences,
} from '../../utils/entityConversion';
import { ErrorHandler } from '../../utils/errorHandling';
import { PropertyEntitySelector } from './shared/PropertyEntitySelector';
import { PropertyOptionSelector } from './shared/PropertyOptionSelector';

// Common CSS classes
const MODAL_BASE =
  'absolute bg-dialog border-3 border-edge shadow-xl z-modal max-h-96 overflow-hidden flex flex-col w-full max-w-md';
const HEADER_CLASSES = 'flex items-center justify-between pt-3 pb-2 px-4';
const CONTENT_CLASSES = 'flex-1 max-h-64 pt-2 px-4 pb-4';

export function EditPropertyValueModal(props: PropertyEditorProps) {
  const blockId = useBlockId();

  const [selectedEntityRefs, setSelectedEntityRefs] = createSignal<
    EntityReference[]
  >(
    props.property.valueType === 'ENTITY' && props.property.value
      ? props.property.value
      : []
  );

  const {
    state: editorState,
    fetchOptions,
    initializeSelectedOptions,
    toggleOption,
    addOption,
  } = usePropertyEditor(props.property);

  const saveChanges = async () => {
    const selectedArray = Array.from(editorState().selectedOptions);

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
      default:
        // Should not reach here as modal only handles select and entity types
        ErrorHandler.handleApiError(
          new Error(
            `Invalid property type for modal editor: ${props.property.valueType}`
          ),
          'PropertyEditor.saveChanges',
          'Invalid property type'
        );
        return;
    }

    // savePropertyValue already handles error logging and user feedback
    const result = await savePropertyValue(
      blockId,
      props.entityType,
      props.property,
      apiValues
    );

    if (result.ok) {
      props.onSaved();
    }

    props.onClose();
  };

  const hasEntityChanges = () => {
    if (props.property.valueType !== 'ENTITY') return false;

    const currentRefs = selectedEntityRefs();
    const originalRefs = (props.property.value as EntityReference[]) || [];

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

  const handleClose = async () => {
    // All properties that reach this modal (select and entity types) should auto-save
    const hasChanges = editorState().hasChanges || hasEntityChanges();
    if (hasChanges) {
      await saveChanges();
    } else {
      props.onClose();
    }
  };

  let modalRef!: HTMLDivElement;

  onMount(() => {
    initializeSelectedOptions();
    if (
      props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER'
    ) {
      fetchOptions();
    }
  });

  createEffect(() => {
    const handleResize = () => {
      if (modalRef && props.position) {
        const constrainedPosition = constrainModalToViewport(
          props.position,
          MODAL_DIMENSIONS.DEFAULT_WIDTH,
          MODAL_DIMENSIONS.DEFAULT_HEIGHT
        );

        modalRef.style.top = `${constrainedPosition.top}px`;
        modalRef.style.left = `${constrainedPosition.left}px`;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  return (
    <Portal>
      <div
        class="fixed inset-0 bg-overlay z-modal-overlay"
        onClick={handleClose}
      >
        <div
          ref={modalRef}
          class={`${MODAL_BASE} ${MODAL_VIEWPORT_CLASSES}`}
          style={createMemo(() => {
            if (!props.position) {
              return {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              };
            }

            const constrainedPosition = constrainModalToViewport(
              props.position,
              MODAL_DIMENSIONS.DEFAULT_WIDTH,
              MODAL_DIMENSIONS.DEFAULT_HEIGHT
            );

            return {
              top: `${constrainedPosition.top}px`,
              left: `${constrainedPosition.left}px`,
            };
          })()}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="bg-dialog text-ink font-mono">
            <div class={HEADER_CLASSES}>
              <div>
                <h3 class="text-base font-semibold text-ink">
                  {props.property.displayName}
                </h3>
                <p class="text-xs text-ink-muted mt-1">
                  {`${props.property.isMultiSelect ? 'Multi-select ' : ''}${getValueTypeDisplay(props.property)}`}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <IconButton
                  icon={XIcon}
                  theme="clear"
                  size="sm"
                  onClick={handleClose}
                />
              </div>
            </div>

            <div class={CONTENT_CLASSES}>
              <Show
                when={
                  props.property.valueType === 'SELECT_STRING' ||
                  props.property.valueType === 'SELECT_NUMBER'
                }
                fallback={
                  <Show when={props.property.valueType === 'ENTITY'}>
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
                    />
                  </Show>
                }
              >
                <PropertyOptionSelector
                  property={props.property}
                  options={editorState().options}
                  isLoading={editorState().isLoading}
                  error={editorState().error}
                  selectedOptions={() => editorState().selectedOptions}
                  onToggleOption={toggleOption}
                  onRetry={fetchOptions}
                  onAddOption={addOption}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
