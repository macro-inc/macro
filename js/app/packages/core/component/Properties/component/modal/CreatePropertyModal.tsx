import { IconButton } from '@core/component/IconButton';
import { useOrganizationId } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { MODAL_VIEWPORT_CLASSES } from '@core/util/modalUtils';
import LoadingSpinner from '@icon/regular/spinner.svg';
import XIcon from '@icon/regular/x.svg';
import { useUserId } from '@service-gql/client';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDataType } from '@service-properties/generated/schemas/propertyDataType';
import {
  type Component,
  createMemo,
  createSignal,
  Index,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  BUTTON_BASE_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
} from '../../constants';
import {
  getPropertyDataTypeDropdownOptions,
  usePropertyNameFocus,
} from '../../utils';
import { ERROR_MESSAGES } from '../../utils/errorHandling';
import { Dropdown, type DropdownOption } from './shared/Dropdown';

// Derive DataTypeValue from the dropdown options
type DataTypeValue = ReturnType<
  typeof getPropertyDataTypeDropdownOptions
>[number]['value'];

interface CreatePropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropertyCreated?: () => void;
}

export const CreatePropertyModal: Component<CreatePropertyModalProps> = (
  props
) => {
  const [isCreatingProperty, setIsCreatingProperty] = createSignal(false);
  const [newPropertyName, setNewPropertyName] = createSignal('');
  const [selectedDataType, setSelectedDataType] =
    createSignal<DataTypeValue>('string');
  const [isMultiSelect, setIsMultiSelect] = createSignal(false);
  const [newStringOptions, setNewStringOptions] = createSignal<
    Array<{ id: string; value: string; display_order: number }>
  >([]);
  const [newNumberOptions, setNewNumberOptions] = createSignal<
    Array<{ id: string; value: number; display_order: number }>
  >([]);
  const [error, setError] = createSignal<string | null>(null);

  let propertyNameInputRef!: HTMLInputElement;

  const organizationId = useOrganizationId();
  const userId = useUserId();

  const dataTypeDropdownOptions: DropdownOption<DataTypeValue>[] =
    getPropertyDataTypeDropdownOptions();

  // Helper to parse selected value back to type and specificType
  const parseDataTypeValue = (
    value: DataTypeValue
  ): {
    type:
      | 'string'
      | 'number'
      | 'boolean'
      | 'date'
      | 'entity'
      | 'select_number'
      | 'select_string'
      | 'link';
    specificType?: EntityType | null;
  } => {
    if (value.startsWith('entity:')) {
      const specificType = value.split(':')[1] as EntityType;
      return { type: 'entity', specificType };
    }
    if (value === 'entity') {
      return { type: 'entity', specificType: null };
    }
    return {
      type: value as
        | 'string'
        | 'number'
        | 'boolean'
        | 'date'
        | 'select_number'
        | 'select_string'
        | 'link',
    };
  };

  const buildDataType = (): PropertyDataType => {
    const { type, specificType } = parseDataTypeValue(selectedDataType());

    switch (type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'date':
        return { type: 'date' };
      case 'link':
        return { type: 'link', multi: isMultiSelect() };
      case 'select_string':
        // Filter out empty options and deduplicate
        const stringOptions = newStringOptions()
          .filter((opt) => opt.value.trim() !== '')
          .map((opt, idx) => ({
            value: opt.value.trim(),
            display_order: idx,
          }));

        // Deduplicate by value
        const uniqueStringOptions = stringOptions.filter(
          (opt, idx, arr) => arr.findIndex((o) => o.value === opt.value) === idx
        );

        return {
          type: 'select_string',
          multi: isMultiSelect(),
          options: uniqueStringOptions,
        };
      case 'select_number':
        // Filter out empty options and deduplicate
        const numberOptions = newNumberOptions()
          .filter((opt) => !isNaN(opt.value))
          .map((opt, idx) => ({
            value: opt.value,
            display_order: idx,
          }));

        // Deduplicate by value
        const uniqueNumberOptions = numberOptions.filter(
          (opt, idx, arr) => arr.findIndex((o) => o.value === opt.value) === idx
        );

        return {
          type: 'select_number',
          multi: isMultiSelect(),
          options: uniqueNumberOptions,
        };
      case 'entity':
        return {
          type: 'entity',
          multi: isMultiSelect(),
          specific_type: specificType,
        };
      default:
        throw new Error(`Unknown data type: ${type}`);
    }
  };

  const handleCreateProperty = async () => {
    const orgId = organizationId();
    const currentUserId = userId();

    if (!newPropertyName().trim()) {
      setError(ERROR_MESSAGES.VALIDATION_REQUIRED);
      return;
    }

    // Check for duplicate options if options are required
    if (shouldShowOptions() && hasDuplicateOptions()) {
      setError(ERROR_MESSAGES.VALIDATION_DUPLICATE);
      return;
    }

    // Validate that select types have at least one option
    if (
      (selectedDataType() === 'select_string' ||
        selectedDataType() === 'select_number') &&
      getOptionsForCurrentType().length === 0
    ) {
      setError(ERROR_MESSAGES.VALIDATION_MIN_OPTIONS);
      return;
    }

    // Validate that we have a user ID for user-scoped properties
    if (!orgId && !currentUserId) {
      setError('Unable to create property: user information not available');
      return;
    }

    setIsCreatingProperty(true);
    setError(null);

    try {
      const bodyData = orgId
        ? {
            scope: 'user_and_organization' as const,
            organization_id: Number(orgId),
            user_id: currentUserId!,
            display_name: newPropertyName().trim(),
            data_type: buildDataType(),
          }
        : {
            scope: 'user' as const,
            user_id: currentUserId!,
            display_name: newPropertyName().trim(),
            data_type: buildDataType(),
          };

      const result = await propertiesServiceClient.createPropertyDefinition({
        body: bodyData,
      });

      if (isErr(result)) {
        setError(ERROR_MESSAGES.CREATE_PROPERTY);
        return;
      }

      resetCreateForm();
      props.onPropertyCreated?.();
      props.onClose();
    } catch (_error) {
      setError(ERROR_MESSAGES.CREATE_PROPERTY);
    } finally {
      setIsCreatingProperty(false);
    }
  };

  const resetCreateForm = () => {
    setNewPropertyName('');
    setSelectedDataType('string');
    setIsMultiSelect(false);
    setNewStringOptions([]);
    setNewNumberOptions([]);
    setError(null);
  };

  const addNewStringOption = () => {
    const newOption = {
      id: crypto.randomUUID(),
      value: '',
      display_order: newStringOptions().length,
    };
    setNewStringOptions([...newStringOptions(), newOption]);
    return newOption.id;
  };

  const addNewNumberOption = () => {
    const newOption = {
      id: crypto.randomUUID(),
      value: 0,
      display_order: newNumberOptions().length,
    };
    setNewNumberOptions([...newNumberOptions(), newOption]);
    return newOption.id;
  };

  const hasDuplicateOptions = () => {
    const dataType = selectedDataType();

    if (dataType === 'select_string') {
      const values = newStringOptions()
        .map((opt) => opt.value.trim())
        .filter((v) => v !== '');
      return new Set(values).size !== values.length;
    }

    if (dataType === 'select_number') {
      const values = newNumberOptions().map((opt) => opt.value);
      return new Set(values).size !== values.length;
    }

    return false;
  };

  const handleOptionKeyDown = (
    e: KeyboardEvent,
    _optionId: string,
    currentValue: string | number
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      const dataType = selectedDataType();
      const hasValue =
        dataType === 'select_string'
          ? !!(currentValue as string).trim()
          : dataType === 'select_number';

      if (hasValue) {
        const newOptionId =
          dataType === 'select_string'
            ? addNewStringOption()
            : addNewNumberOption();

        setTimeout(() => {
          const newInput = document.querySelector(
            `input[data-option-id="${newOptionId}"]`
          ) as HTMLInputElement;
          if (newInput) {
            newInput.focus();
          }
        }, 50);
      }
    }
  };

  const removeStringOption = (optionId: string) => {
    setNewStringOptions(
      newStringOptions().filter((opt) => opt.id !== optionId)
    );
  };

  const removeNumberOption = (optionId: string) => {
    setNewNumberOptions(
      newNumberOptions().filter((opt) => opt.id !== optionId)
    );
  };

  const updateStringOption = (optionId: string, value: string) => {
    setNewStringOptions(
      newStringOptions().map((opt) =>
        opt.id === optionId ? { ...opt, value } : opt
      )
    );
  };

  const updateNumberOption = (optionId: string, value: number) => {
    setNewNumberOptions(
      newNumberOptions().map((opt) =>
        opt.id === optionId ? { ...opt, value } : opt
      )
    );
  };

  const shouldShowMultiSelect = createMemo(() => {
    const { type } = parseDataTypeValue(selectedDataType());
    return (
      type === 'select_string' ||
      type === 'select_number' ||
      type === 'entity' ||
      type === 'link'
    );
  });

  const shouldShowOptions = createMemo(() => {
    const { type } = parseDataTypeValue(selectedDataType());
    return type === 'select_string' || type === 'select_number';
  });

  const getOptionsForCurrentType = () => {
    const { type } = parseDataTypeValue(selectedDataType());
    return type === 'select_string' ? newStringOptions() : newNumberOptions();
  };

  usePropertyNameFocus(
    () => propertyNameInputRef,
    () => props.isOpen
  );

  return (
    <Portal>
      <div
        class="fixed inset-0 bg-overlay z-modal-overlay"
        onClick={() => props.onClose()}
        onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
        role="dialog"
        aria-modal="true"
      >
        <div
          class={`absolute bg-dialog border-3 border-edge shadow-xl w-full overflow-hidden font-mono max-w-lg max-h-[90vh] ${MODAL_VIEWPORT_CLASSES}`}
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="document"
        >
          <div class="flex items-center justify-between p-4">
            <h3 class="text-base font-semibold text-ink">
              Create New Property
            </h3>
            <IconButton
              icon={XIcon}
              theme="clear"
              size="sm"
              onClick={() => props.onClose()}
            />
          </div>

          <div class="px-4 pb-2 overflow-y-auto max-h-[70vh]">
            <div class="space-y-3">
              <Show when={error()}>
                <div class="text-failure-ink text-sm p-2 bg-failure-bg">
                  {error()}
                </div>
              </Show>

              <div>
                <label
                  for="property-name"
                  class="block text-xs font-medium text-ink mb-1"
                >
                  Property Name
                </label>
                <input
                  id="property-name"
                  ref={propertyNameInputRef}
                  type="text"
                  value={newPropertyName()}
                  onInput={(e) => setNewPropertyName(e.currentTarget.value)}
                  placeholder="Enter property name"
                  class="w-full px-3 py-1.5 border border-edge text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-ink mb-1">
                  Data Type
                </label>
                <Dropdown
                  value={selectedDataType()}
                  options={dataTypeDropdownOptions}
                  onChange={(value) => {
                    setSelectedDataType(value);
                    // Reset options when changing type
                    setNewStringOptions([]);
                    setNewNumberOptions([]);
                    setIsMultiSelect(false);
                  }}
                  placeholder="Select type"
                />
              </div>

              <Show when={shouldShowMultiSelect()}>
                <div>
                  <label class="block text-xs font-medium text-ink mb-1">
                    Selection Type
                  </label>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsMultiSelect(false)}
                      class={`flex-1 px-3 py-1.5 text-sm border ${!isMultiSelect() ? 'border-accent bg-active text-accent-ink' : 'bg-button border-edge text-ink hover:bg-hover'}`}
                    >
                      Single Select
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMultiSelect(true)}
                      class={`flex-1 px-3 py-1.5 text-sm border ${isMultiSelect() ? 'border-accent bg-active text-accent-ink' : 'bg-button border-edge text-ink hover:bg-hover'}`}
                    >
                      Multi Select
                    </button>
                  </div>
                </div>
              </Show>

              <Show when={shouldShowOptions()}>
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <label class="block text-xs font-medium text-ink">
                      Options
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        selectedDataType() === 'select_string'
                          ? addNewStringOption()
                          : addNewNumberOption()
                      }
                      class="px-2 py-1 text-xs bg-accent text-ink hover:bg-accent/90"
                    >
                      + Add Option
                    </button>
                  </div>
                  <div class="space-y-2 max-h-40 overflow-y-auto">
                    <Show
                      when={selectedDataType() === 'select_string'}
                      fallback={
                        <Index each={newNumberOptions()}>
                          {(option) => (
                            <div class="flex items-center gap-2">
                              <input
                                type="number"
                                value={option().value}
                                onInput={(e) =>
                                  updateNumberOption(
                                    option().id,
                                    Number(e.currentTarget.value)
                                  )
                                }
                                onKeyDown={(e) =>
                                  handleOptionKeyDown(
                                    e,
                                    option().id,
                                    option().value
                                  )
                                }
                                placeholder="Enter number"
                                class="flex-1 px-2 py-1 border border-edge text-sm"
                                data-option-id={option().id}
                              />
                              <button
                                type="button"
                                onClick={() => removeNumberOption(option().id)}
                                class="text-failure-ink hover:text-failure-ink text-md px-1"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </Index>
                      }
                    >
                      <Index each={newStringOptions()}>
                        {(option) => (
                          <div class="flex items-center gap-2">
                            <input
                              type="text"
                              value={option().value}
                              onInput={(e) =>
                                updateStringOption(
                                  option().id,
                                  e.currentTarget.value
                                )
                              }
                              onKeyDown={(e) =>
                                handleOptionKeyDown(
                                  e,
                                  option().id,
                                  option().value
                                )
                              }
                              placeholder="Enter option value"
                              class="flex-1 px-2 py-1 border border-edge text-sm"
                              data-option-id={option().id}
                            />
                            <button
                              type="button"
                              onClick={() => removeStringOption(option().id)}
                              class="text-failure-ink hover:text-failure-ink text-md px-1"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </Index>
                    </Show>
                    <Show when={getOptionsForCurrentType().length === 0}>
                      <div class="text-center py-4 text-ink-muted text-sm">
                        No options added yet
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          <div class="flex items-center justify-between p-4 pt-2">
            <div class="flex gap-2">
              <button
                type="button"
                class={`${BUTTON_BASE_CLASSES} ${SECONDARY_BUTTON_CLASSES}`}
                onClick={() => {
                  resetCreateForm();
                  props.onClose();
                }}
                disabled={isCreatingProperty()}
              >
                Cancel
              </button>
            </div>
            <button
              type="button"
              class={`${BUTTON_BASE_CLASSES} ${newPropertyName().trim() && !isCreatingProperty() ? PRIMARY_BUTTON_CLASSES : 'bg-ink-muted text-ink cursor-not-allowed'}`}
              onClick={handleCreateProperty}
              disabled={!newPropertyName().trim() || isCreatingProperty()}
            >
              <Show
                when={!isCreatingProperty()}
                fallback={
                  <div class="flex items-center gap-1.5">
                    <div class="w-3 h-3 animate-spin">
                      <LoadingSpinner />
                    </div>
                    Creating...
                  </div>
                }
              >
                Create Property
              </Show>
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
