import { useBlockId } from '@core/block';
import { TabsInset } from '@core/component/TabsInset';
import { useUserId } from '@core/context/user';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import SlidersIcon from '@phosphor/sliders-horizontal.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { useCreatePropertyDefinitionMutation } from '@queries/properties/definitions';
import { useAddEntityPropertyMutation } from '@queries/properties/entity';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { CreatePropertyScope } from '@service-properties/generated/schemas/createPropertyScope';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDataType } from '@service-properties/generated/schemas/propertyDataType';
import { Button, CommandMenuShell, cn, Dialog, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
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

function EditorRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-12 items-center gap-5 px-4 py-3">
      <div class="w-22 shrink-0 text-xs font-medium text-ink-extra-muted">
        {props.label}
      </div>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

const inputClass =
  'h-9 min-w-0 w-full flex-1 rounded-md border border-edge-muted bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent';

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
    <div class="max-h-40 space-y-2 overflow-y-auto">
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
              class={inputClass}
              data-option-id={option().id}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              label="Remove option"
              onClick={() => props.onRemove(option().id)}
              class="shrink-0 rounded-lg text-failure-ink"
            >
              <XIcon />
            </Button>
          </div>
        )}
      </Index>
      <Show when={props.options().length === 0}>
        <div class="py-4 text-center text-sm text-ink-muted">
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
  const [propertyScope, setPropertyScope] =
    createSignal<CreatePropertyScope>('user');
  const [isMultiSelect, setIsMultiSelect] = createSignal(false);
  const [newStringOptions, setNewStringOptions] = createSignal<
    Array<{ id: string; value: string; display_order: number }>
  >([]);
  const [newNumberOptions, setNewNumberOptions] = createSignal<
    Array<{ id: string; value: number; display_order: number }>
  >([]);
  const [error, setError] = createSignal<string | null>(null);

  const addMutation = useAddEntityPropertyMutation();
  const currentTeamQuery = useCurrentTeamQuery();

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
  const hasTeam = () => Boolean(currentTeamQuery.data?.team);
  const selectedPropertyScope = (): CreatePropertyScope =>
    propertyScope() === 'team' && hasTeam() ? 'team' : 'user';

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
      scope: selectedPropertyScope(),
      display_name: newPropertyName().trim(),
      data_type: buildDataType(),
    };

    createPropertyMutation.mutate({ body: bodyData });
  };

  const resetCreateForm = () => {
    setNewPropertyName('');
    setSelectedDataType('string');
    setPropertyScope('user');
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

  const pending = () =>
    createPropertyMutation.isPending || addMutation.isPending;

  const canSubmit = () => newPropertyName().trim().length > 0 && !pending();

  const close = () => {
    if (pending()) return;
    resetCreateForm();
    props.onClose();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (canSubmit()) handleCreateProperty();
    }
  };

  const addCurrentOption = () => {
    const { type } = parseDataTypeValue(selectedDataType());
    if (type === 'select_string') {
      addOption(newStringOptions, setNewStringOptions, '');
      return;
    }

    addOption(newNumberOptions, setNewNumberOptions, 0);
  };

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <CommandMenuShell depth={2} class="text-sm" onKeyDown={handleKeyDown}>
        <CommandMenuShell.Header class="my-0 h-13 gap-3 border-b-0 px-4">
          <span class="text-ink-muted">
            <SlidersIcon class="size-3.5" />
          </span>
          <Dialog.Title
            as="span"
            class="min-w-0 flex-1 truncate text-sm font-semibold text-ink-extra-muted"
          >
            Create property
          </Dialog.Title>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={pending()}
            label="Close"
          >
            <XIcon />
          </Dialog.CloseButton>
        </CommandMenuShell.Header>

        <CommandMenuShell.Body>
          <div class="bg-surface">
            <Show when={error()}>
              <div class="mx-4 mb-1 rounded-md bg-failure-bg px-3 py-2 text-sm text-failure-ink">
                {error()}
              </div>
            </Show>

            <EditorRow label="Name">
              <input
                id="property-name"
                ref={propertyNameInputRef}
                type="text"
                value={newPropertyName()}
                onInput={(e) => setNewPropertyName(e.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSubmit()) {
                    handleCreateProperty();
                  }
                }}
                placeholder="Property name"
                class={inputClass}
              />
            </EditorRow>

            <EditorRow label="Type">
              <Dropdown>
                <Dropdown.Trigger class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-edge-muted bg-surface px-3 text-left text-sm text-ink outline-none hover:bg-hover focus-visible:border-accent">
                  <span class="truncate">{selectedDataTypeLabel()}</span>
                  <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.Trigger>
                <Dropdown.Content class="max-h-64 min-w-56 overflow-y-auto">
                  <Dropdown.Group>
                    <For each={dataTypeDropdownOptions}>
                      {(option) => (
                        <Dropdown.Item
                          class="justify-between"
                          onSelect={() => {
                            setSelectedDataType(option.value);
                            setNewStringOptions([]);
                            setNewNumberOptions([]);
                            setIsMultiSelect(false);
                          }}
                        >
                          <span>{option.label}</span>
                          <Show when={option.value === selectedDataType()}>
                            <CheckIcon class="size-3 shrink-0" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </EditorRow>

            <Show when={hasTeam()}>
              <EditorRow label="Owner">
                <TabsInset
                  depth={0}
                  list={[
                    { value: 'user', label: 'Personal' },
                    { value: 'team', label: 'Team' },
                  ]}
                  value={selectedPropertyScope()}
                  onChange={(value) => {
                    if (value === 'user' || value === 'team') {
                      setPropertyScope(value);
                    }
                  }}
                />
              </EditorRow>
            </Show>

            <Show when={shouldShowMultiSelect()}>
              <EditorRow label="Selection">
                <TabsInset
                  depth={0}
                  list={[
                    { value: 'single', label: 'Single' },
                    { value: 'multi', label: 'Multi' },
                  ]}
                  value={isMultiSelect() ? 'multi' : 'single'}
                  onChange={(value) => setIsMultiSelect(value === 'multi')}
                />
              </EditorRow>
            </Show>

            <Show when={shouldShowOptions()}>
              <EditorRow label="Options">
                <div class="space-y-3">
                  <div class="flex justify-end">
                    <Button
                      variant="base"
                      size="sm"
                      class="rounded-lg"
                      onClick={addCurrentOption}
                    >
                      <PlusIcon />
                      Add option
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
                        placeholder="Number"
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
                      placeholder="Option value"
                    />
                  </Show>
                </div>
              </EditorRow>
            </Show>
          </div>
        </CommandMenuShell.Body>

        <CommandMenuShell.Footer class="gap-2 border-t-0 py-3">
          <div class="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              class="rounded-lg"
              onClick={close}
              disabled={pending()}
            >
              Cancel
            </Button>
            <Button
              variant={canSubmit() ? 'active' : 'ghost'}
              depth={3}
              class={cn('gap-3 rounded-lg border-0', pending() && 'gap-1.5')}
              onClick={handleCreateProperty}
              disabled={!canSubmit()}
            >
              <Show
                when={!pending()}
                fallback={
                  <>
                    <span class="size-3 animate-spin">
                      <LoadingSpinner />
                    </span>
                    Creating
                  </>
                }
              >
                Create
                <Hotkey shortcut="cmd+enter" theme="current" />
              </Show>
            </Button>
          </div>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
};
