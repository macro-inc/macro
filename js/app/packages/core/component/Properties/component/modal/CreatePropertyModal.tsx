import { useBlockId } from '@core/block';
import { useUserId } from '@core/context/user';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { useCreatePropertyDefinitionMutation } from '@queries/properties/definitions';
import { useAddEntityPropertyMutation } from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDataType } from '@service-properties/generated/schemas/propertyDataType';
import { Button, Dialog, Dropdown, SegmentedControl, Surface } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Index,
  Show,
} from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import {
  getPropertyDataTypeDropdownOptions,
  usePropertyNameFocus,
} from '../../utils';
import { ERROR_MESSAGES } from '../../utils/errorHandling';

// Derive DataTypeValue from the dropdown options
type DataTypeValue = ReturnType<
  typeof getPropertyDataTypeDropdownOptions
>[number]['value'];

type Option<T> = {
  id: string;
  value: T;
  display_order: number;
};

type OptionInputProps<T extends string | number> = {
  options: () => Option<T>[];
  type: 'string' | 'number';
  onAdd: () => string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, value: T) => void;
  placeholder?: string;
};

const OptionInput: Component<OptionInputProps<string | number>> = (props) => {
  const handleKeyDown = (
    e: KeyboardEvent,
    _optionId: string,
    currentValue: string | number
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      const hasValue =
        props.type === 'string'
          ? !!(currentValue as string).trim()
          : props.type === 'number';

      if (hasValue) {
        const newOptionId = props.onAdd();

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

  return (
    <div class="space-y-2 max-h-40 overflow-y-auto">
      <Index each={props.options()}>
        {(option) => (
          <div class="flex items-center gap-2">
            <input
              type={props.type === 'string' ? 'text' : 'number'}
              value={option().value}
              onInput={(e) => {
                const value =
                  props.type === 'string'
                    ? e.currentTarget.value
                    : Number(e.currentTarget.value);
                props.onUpdate(option().id, value as string | number);
              }}
              onKeyDown={(e) => handleKeyDown(e, option().id, option().value)}
              placeholder={props.placeholder}
              class="flex-1 p-1.5 border border-edge-muted text-sm rounded-sm bg-surface placeholder:text-ink-placeholder"
              data-option-id={option().id}
            />
            <button
              type="button"
              onClick={() => props.onRemove(option().id)}
              class="text-failure-ink hover:text-failure-ink text-md px-1"
            >
              ×
            </button>
          </div>
        )}
      </Index>
      <Show when={props.options().length === 0}>
        <div class="text-center py-4 text-ink-muted text-sm">
          No options added yet
        </div>
      </Show>
    </div>
  );
};

interface CreatePropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropertyCreated?: (propertyDefinitionId?: string) => void;
  autoPinOnCreate?: boolean;
}

export const CreatePropertyModal: Component<CreatePropertyModalProps> = (
  props
) => {
  const blockId = useBlockId();
  const { entityType } = usePropertiesContext();

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

  const addMutation = useAddEntityPropertyMutation();

  const createPropertyMutation = useCreatePropertyDefinitionMutation({
    onSuccess: async (propertyDefinition) => {
      // Add the property to the current entity if autoPinOnCreate is true
      if (props.autoPinOnCreate && blockId) {
        try {
          await addMutation.mutateAsync({
            entityId: blockId,
            entityType,
            propertyDefinitionId: propertyDefinition.id,
          });

          resetCreateForm();
          // Pass the property definition ID so parent can pin it after refresh
          props.onPropertyCreated?.(propertyDefinition.id);
          props.onClose();
        } catch (error) {
          console.error('Failed to add property to entity', error);
          setError(ERROR_MESSAGES.PROPERTY_CREATE);
        }
      } else {
        resetCreateForm();
        props.onPropertyCreated?.();
        props.onClose();
      }
    },
    onError: () => {
      setError(ERROR_MESSAGES.PROPERTY_CREATE);
    },
  });

  // Unified option management helpers
  type Option<T> = { id: string; value: T; display_order: number };

  const addOption = <T extends string | number>(
    options: () => Option<T>[],
    setOptions: (options: Option<T>[]) => void,
    defaultValue: T
  ): string => {
    const newOption: Option<T> = {
      id: crypto.randomUUID(),
      value: defaultValue,
      display_order: options().length,
    };
    setOptions([...options(), newOption]);
    return newOption.id;
  };

  const removeOption = <T extends string | number>(
    options: () => Option<T>[],
    setOptions: (options: Option<T>[]) => void,
    optionId: string
  ) => {
    setOptions(options().filter((opt) => opt.id !== optionId));
  };

  const updateOption = <T extends string | number>(
    options: () => Option<T>[],
    setOptions: (options: Option<T>[]) => void,
    optionId: string,
    value: T
  ) => {
    setOptions(
      options().map((opt) => (opt.id === optionId ? { ...opt, value } : opt))
    );
  };

  const hasDuplicateOptions = <T extends string | number>(
    options: () => Option<T>[]
  ): boolean => {
    const values = options().map((opt) =>
      typeof opt.value === 'string' ? opt.value.trim() : opt.value
    );
    const nonEmptyValues = values.filter((v) =>
      typeof v === 'string' ? v !== '' : !isNaN(v)
    );
    return new Set(nonEmptyValues).size !== nonEmptyValues.length;
  };

  let propertyNameInputRef!: HTMLInputElement;

  const userId = useUserId();

  const dataTypeDropdownOptions = getPropertyDataTypeDropdownOptions();

  const selectedDataTypeLabel = createMemo(() => {
    const option = dataTypeDropdownOptions.find(
      (opt) => opt.value === selectedDataType()
    );
    return option?.label ?? 'Select type';
  });

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

  const handleCreateProperty = () => {
    const currentUserId = userId();

    if (!newPropertyName().trim()) {
      setError(ERROR_MESSAGES.VALIDATION_REQUIRED);
      return;
    }

    // Check for duplicate options if options are required
    if (shouldShowOptions()) {
      const { type } = parseDataTypeValue(selectedDataType());
      const hasDuplicates =
        type === 'select_string'
          ? hasDuplicateOptions(newStringOptions)
          : hasDuplicateOptions(newNumberOptions);
      if (hasDuplicates) {
        setError(ERROR_MESSAGES.VALIDATION_DUPLICATE);
        return;
      }
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
    if (!currentUserId) {
      setError(ERROR_MESSAGES.PROPERTY_CREATE);
      return;
    }

    setError(null);

    const bodyData = {
      scope: 'user' as const,
      user_id: currentUserId!,
      display_name: newPropertyName().trim(),
      data_type: buildDataType(),
    };

    createPropertyMutation.mutate({ body: bodyData });
  };

  const resetCreateForm = () => {
    setNewPropertyName('');
    setSelectedDataType('string');
    setIsMultiSelect(false);
    setNewStringOptions([]);
    setNewNumberOptions([]);
    setError(null);
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
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Surface depth={2} class="*:max-h-[75vh] rounded-xl">
        <div class="flex flex-col text-sm">
          <div class="flex items-center justify-between gap-2 bg-surface px-2 h-10 border-b border-edge-muted shrink-0">
            <Dialog.Title class="pl-2 text-sm font-medium">
              Create New Property
            </Dialog.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => props.onClose()}
            >
              <XIcon />
            </Button>
          </div>

          <div class="min-h-0 overflow-y-auto scrollbar-hidden p-4">
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
                  class="w-full p-1.5 border border-edge-muted text-sm rounded-sm bg-surface placeholder:text-ink-placeholder"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-ink mb-1">
                  Data Type
                </label>
                <Dropdown gutter={4}>
                  <Dropdown.Trigger class="w-full p-1.5 border border-edge-muted bg-surface text-sm text-ink text-left flex items-center gap-2 hover:bg-hover rounded-sm justify-between">
                    <span class="truncate">{selectedDataTypeLabel()}</span>
                    <CaretDownIcon class="size-3 text-ink-muted shrink-0" />
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <Dropdown.Content class="max-h-64 overflow-y-auto min-w-48">
                      <For each={dataTypeDropdownOptions}>
                        {(option) => (
                          <Dropdown.Item
                            class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm cursor-pointer"
                            onSelect={() => {
                              setSelectedDataType(option.value);
                              setNewStringOptions([]);
                              setNewNumberOptions([]);
                              setIsMultiSelect(false);
                            }}
                          >
                            <Dropdown.ItemLabel>
                              {option.label}
                            </Dropdown.ItemLabel>
                            <Show when={option.value === selectedDataType()}>
                              <CheckIcon class="size-3 shrink-0" />
                            </Show>
                          </Dropdown.Item>
                        )}
                      </For>
                    </Dropdown.Content>
                  </Dropdown.Portal>
                </Dropdown>
              </div>

              <Show when={shouldShowMultiSelect()}>
                <div>
                  <label class="block text-xs font-medium text-ink mb-1">
                    Selection Type
                  </label>
                  <SegmentedControl
                    value={isMultiSelect() ? 'multi' : 'single'}
                    onChange={(v) => setIsMultiSelect(v === 'multi')}
                    options={[
                      { value: 'single', label: 'Single Select' },
                      { value: 'multi', label: 'Multi Select' },
                    ]}
                  />
                </div>
              </Show>

              <Show when={shouldShowOptions()}>
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <label class="block text-xs font-medium text-ink">
                      Options
                    </label>
                    <Button
                      variant="base"
                      size="sm"
                      class="rounded-xs"
                      onClick={() => {
                        const { type } = parseDataTypeValue(selectedDataType());
                        if (type === 'select_string') {
                          addOption(newStringOptions, setNewStringOptions, '');
                        } else {
                          addOption(newNumberOptions, setNewNumberOptions, 0);
                        }
                      }}
                    >
                      + Add Option
                    </Button>
                  </div>
                  <Show
                    when={selectedDataType() === 'select_string'}
                    fallback={
                      <OptionInput
                        options={newNumberOptions}
                        type="number"
                        onAdd={() =>
                          addOption(newNumberOptions, setNewNumberOptions, 0)
                        }
                        onRemove={(id) =>
                          removeOption(
                            newNumberOptions,
                            setNewNumberOptions,
                            id
                          )
                        }
                        onUpdate={(id, value) =>
                          updateOption(
                            newNumberOptions,
                            setNewNumberOptions,
                            id,
                            value as number
                          )
                        }
                        placeholder="Enter number"
                      />
                    }
                  >
                    <OptionInput
                      options={newStringOptions}
                      type="string"
                      onAdd={() =>
                        addOption(newStringOptions, setNewStringOptions, '')
                      }
                      onRemove={(id) =>
                        removeOption(newStringOptions, setNewStringOptions, id)
                      }
                      onUpdate={(id, value) =>
                        updateOption(
                          newStringOptions,
                          setNewStringOptions,
                          id,
                          value as string
                        )
                      }
                      placeholder="Enter option value"
                    />
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-edge-muted shrink-0">
            <Button
              variant="ghost"
              class="rounded-xs"
              onClick={() => {
                resetCreateForm();
                props.onClose();
              }}
              disabled={createPropertyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="base"
              class="rounded-xs"
              onClick={handleCreateProperty}
              disabled={
                !newPropertyName().trim() || createPropertyMutation.isPending
              }
            >
              <Show
                when={!createPropertyMutation.isPending}
                fallback={
                  <div class="flex items-center gap-1.5">
                    <div class="size-3 animate-spin">
                      <LoadingSpinner />
                    </div>
                    Creating...
                  </div>
                }
              >
                Create Property
              </Show>
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
};
