import { useMaybeBlockId } from '@core/block';
import { TabsInset } from '@core/component/TabsInset';
import { useUserId } from '@core/context/user';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SlidersIcon from '@phosphor/sliders-horizontal.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { useCreatePropertyDefinitionMutation } from '@queries/properties/definitions';
import { useAddEntityPropertyMutation } from '@queries/properties/entity';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { CreatePropertyScope } from '@service-properties/generated/schemas/createPropertyScope';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDataType } from '@service-properties/generated/schemas/propertyDataType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import {
  addCtrlJKMenuNavigation,
  Button,
  CommandMenuShell,
  cn,
  Dialog,
  Hotkey,
  Layer,
} from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Index,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { useMaybePropertiesContext } from '../../context/PropertiesContext';
import {
  getPropertyDataTypeDropdownOptions,
  PropertyDataTypeIcon,
  usePropertyNameFocus,
} from '../../utils';
import { ERROR_MESSAGES } from '../../utils/errorHandling';

// Derive DataTypeValue from the dropdown options
type DataTypeValue = ReturnType<
  typeof getPropertyDataTypeDropdownOptions
>[number]['value'];
type DataTypeOption = ReturnType<
  typeof getPropertyDataTypeDropdownOptions
>[number];

type Option<T> = {
  id: string;
  value: T;
  display_order: number;
};

type OptionInputProps<T extends string | number> = {
  options: () => Option<T>[];
  type: 'string' | 'number';
  onRemove: (id: string) => void;
  onUpdate: (id: string, value: T) => void;
  placeholder?: string;
};

function EditorRow(props: {
  label: string;
  children: JSX.Element;
  align?: 'center' | 'start';
}) {
  return (
    <div
      class={cn(
        'flex min-h-12 gap-5 px-4 py-3',
        props.align === 'start' ? 'items-start' : 'items-center'
      )}
    >
      <div
        class={cn(
          'w-22 shrink-0 text-xs font-medium text-ink-extra-muted',
          props.align === 'start' && 'pt-2'
        )}
      >
        {props.label}
      </div>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

const inputClass =
  'h-9 min-w-0 w-full flex-1 rounded-md border border-edge-muted bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent';

const hasOptionValue = (value: string | number) =>
  typeof value === 'string' ? value.trim() !== '' : !isNaN(value);

const OptionInput: Component<OptionInputProps<string | number>> = (props) => {
  const handleKeyDown = (
    e: KeyboardEvent,
    optionId: string,
    currentValue: string | number
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      if (hasOptionValue(currentValue)) {
        const currentIndex = props
          .options()
          .findIndex((option) => option.id === optionId);
        const nextOptionId = props.options()[currentIndex + 1]?.id;
        if (!nextOptionId) return;

        setTimeout(() => {
          const newInput = document.querySelector(
            `input[data-option-id="${nextOptionId}"]`
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
                    : e.currentTarget.value === ''
                      ? ''
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
    </div>
  );
};

interface CreatePropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropertyCreated?: (
    propertyDefinitionId?: string,
    propertyDefinition?: PropertyDefinition
  ) => void;
  autoPinOnCreate?: boolean;
  initialName?: string;
  entityId?: string;
  entityType?: EntityType;
}

export const CreatePropertyModal: Component<CreatePropertyModalProps> = (
  props
) => {
  const context = useMaybePropertiesContext();
  const blockId = useMaybeBlockId();
  const entityId = () => props.entityId ?? blockId;
  const entityType = () => props.entityType ?? context?.entityType;

  const [newPropertyName, setNewPropertyName] = createSignal('');
  const [selectedDataType, setSelectedDataType] =
    createSignal<DataTypeValue>('string');
  const [propertyScope, setPropertyScope] =
    createSignal<CreatePropertyScope>('team');
  const [isMultiSelect, setIsMultiSelect] = createSignal(false);
  const [newStringOptions, setNewStringOptions] = createSignal<
    Array<{ id: string; value: string; display_order: number }>
  >([]);
  const [newNumberOptions, setNewNumberOptions] = createSignal<
    Array<{ id: string; value: number | ''; display_order: number }>
  >([]);
  const [error, setError] = createSignal<string | null>(null);

  const addMutation = useAddEntityPropertyMutation();
  const currentTeamQuery = useCurrentTeamQuery();

  const createPropertyMutation = useCreatePropertyDefinitionMutation({
    onSuccess: async (propertyDefinition) => {
      // Add the property to the current entity if autoPinOnCreate is true
      if (props.autoPinOnCreate && entityId() && entityType()) {
        try {
          await addMutation.mutateAsync({
            entityId: entityId()!,
            entityType: entityType()!,
            propertyDefinitionId: propertyDefinition.id,
          });

          resetCreateForm();
          // Pass the property definition ID so parent can pin it after refresh
          props.onPropertyCreated?.(propertyDefinition.id, propertyDefinition);
          props.onClose();
        } catch (error) {
          console.error('Failed to add property to entity', error);
          setError(ERROR_MESSAGES.PROPERTY_CREATE);
        }
      } else {
        resetCreateForm();
        props.onPropertyCreated?.(propertyDefinition.id, propertyDefinition);
        props.onClose();
      }
    },
    onError: () => {
      setError(ERROR_MESSAGES.PROPERTY_CREATE);
    },
  });

  createEffect(() => {
    if (props.isOpen) {
      setNewPropertyName(props.initialName ?? '');
    }
  });

  const createOption = <T extends string | number>(
    value: T,
    displayOrder: number
  ): Option<T> => ({
    id: crypto.randomUUID(),
    value,
    display_order: displayOrder,
  });

  const removeOption = <T extends string | number>(
    options: () => Option<T>[],
    setOptions: (options: Option<T>[]) => void,
    optionId: string,
    defaultValue: T
  ) => {
    const nextOptions = options()
      .filter((opt) => opt.id !== optionId)
      .map((option, index) => ({ ...option, display_order: index }));
    setOptions(ensureTrailingEmptyOption(nextOptions, defaultValue));
  };

  const updateOption = <T extends string | number>(
    options: () => Option<T>[],
    setOptions: (options: Option<T>[]) => void,
    optionId: string,
    value: T,
    defaultValue: T
  ) => {
    const nextOptions = options().map((opt) =>
      opt.id === optionId ? { ...opt, value } : opt
    );
    setOptions(ensureTrailingEmptyOption(nextOptions, defaultValue));
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

  const ensureTrailingEmptyOption = <T extends string | number>(
    options: Option<T>[],
    defaultValue: T
  ): Option<T>[] => {
    if (options.length === 0) return [createOption(defaultValue, 0)];

    const lastOption = options[options.length - 1];
    if (!lastOption || !hasOptionValue(lastOption.value)) return options;

    return [...options, createOption(defaultValue, options.length)];
  };

  let propertyNameInputRef!: HTMLInputElement;

  const userId = useUserId();

  const dataTypeDropdownOptions = getPropertyDataTypeDropdownOptions();

  const selectedDataTypeOption = createMemo(
    () =>
      dataTypeDropdownOptions.find((opt) => opt.value === selectedDataType()) ??
      dataTypeDropdownOptions[0]
  );
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

  // Adapt a dropdown value to the shape `PropertyDataTypeIcon` expects, so the
  // type icons here stay in sync with the property list / tooltip icons.
  const dataTypeIconProperty = (value: DataTypeValue) => {
    const { type, specificType } = parseDataTypeValue(value);
    return {
      valueType: (type === 'entity'
        ? 'ENTITY'
        : type.toUpperCase()) as DataType,
      specificEntityType: specificType ?? null,
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
          .filter((opt) => opt.value !== '' && !isNaN(opt.value))
          .map((opt, idx) => ({
            value: Number(opt.value),
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

  const hasOptionsForCurrentType = () => {
    const { type } = parseDataTypeValue(selectedDataType());
    if (type === 'select_string') {
      return newStringOptions().some((opt) => opt.value.trim() !== '');
    }
    if (type === 'select_number') {
      return newNumberOptions().some(
        (opt) => opt.value !== '' && !isNaN(opt.value)
      );
    }
    return true;
  };

  const resetOptionsForType = (dataType: DataTypeValue) => {
    const { type } = parseDataTypeValue(dataType);
    setNewStringOptions(type === 'select_string' ? [createOption('', 0)] : []);
    setNewNumberOptions(
      type === 'select_number' ? [createOption<number | ''>('', 0)] : []
    );
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
      !hasOptionsForCurrentType()
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
    setPropertyScope('team');
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
              <Select<DataTypeOption>
                options={dataTypeDropdownOptions}
                value={selectedDataTypeOption()}
                onChange={(option) => {
                  if (!option) return;
                  setSelectedDataType(option.value);
                  resetOptionsForType(option.value);
                  setIsMultiSelect(false);
                }}
                optionValue="value"
                optionTextValue="label"
                gutter={4}
                placement="bottom-start"
                itemComponent={(itemProps: {
                  item: CollectionNode<DataTypeOption>;
                }) => (
                  <Select.Item
                    item={itemProps.item}
                    class="flex w-full cursor-default items-center justify-between gap-2 rounded-lg p-1.5 px-2 text-left text-sm font-normal text-ink outline-none data-highlighted:bg-ink/5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <PropertyDataTypeIcon
                        property={dataTypeIconProperty(
                          itemProps.item.rawValue.value
                        )}
                        class="size-4 shrink-0 text-ink-muted"
                      />
                      <Select.ItemLabel class="truncate">
                        {itemProps.item.rawValue.label}
                      </Select.ItemLabel>
                    </div>
                    <Select.ItemIndicator>
                      <CheckIcon class="size-3 shrink-0" />
                    </Select.ItemIndicator>
                  </Select.Item>
                )}
              >
                <Select.Trigger class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-edge-muted bg-surface px-3 text-left text-sm text-ink outline-none hover:bg-hover focus-visible:border-accent data-expanded:bg-hover">
                  <Select.Value<DataTypeOption>>
                    {(state) => (
                      <span class="flex min-w-0 items-center gap-2">
                        <PropertyDataTypeIcon
                          property={dataTypeIconProperty(
                            state.selectedOption().value
                          )}
                          class="size-4 shrink-0 text-ink-muted"
                        />
                        <span class="truncate">
                          {state.selectedOption().label}
                        </span>
                      </span>
                    )}
                  </Select.Value>
                  <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                </Select.Trigger>
                <Select.Portal>
                  <Layer depth={3}>
                    <Select.Content
                      class="z-action-menu min-w-56 overflow-y-auto rounded-xl border border-edge bg-surface p-1.5 shadow-menu menu-open-animation"
                      ref={(el) => {
                        const clean = addCtrlJKMenuNavigation(el, () => ({
                          wrap: true,
                        }));
                        onCleanup(clean);
                      }}
                    >
                      <Select.Listbox class="flex flex-col gap-(--app-border-width)" />
                    </Select.Content>
                  </Layer>
                </Select.Portal>
              </Select>
            </EditorRow>

            <Show when={hasTeam()}>
              <EditorRow label="Owner">
                <TabsInset
                  depth={0}
                  list={[
                    { value: 'team', label: 'Team' },
                    { value: 'user', label: 'Personal' },
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
              <EditorRow label="Options" align="start">
                <div>
                  <Show
                    when={selectedDataType() === 'select_string'}
                    fallback={
                      <OptionInput
                        options={newNumberOptions}
                        type="number"
                        onRemove={(id) =>
                          removeOption(
                            newNumberOptions,
                            setNewNumberOptions,
                            id,
                            ''
                          )
                        }
                        onUpdate={(id, value) =>
                          updateOption(
                            newNumberOptions,
                            setNewNumberOptions,
                            id,
                            value as number | '',
                            ''
                          )
                        }
                        placeholder="Number"
                      />
                    }
                  >
                    <OptionInput
                      options={newStringOptions}
                      type="string"
                      onRemove={(id) =>
                        removeOption(
                          newStringOptions,
                          setNewStringOptions,
                          id,
                          ''
                        )
                      }
                      onUpdate={(id, value) =>
                        updateOption(
                          newStringOptions,
                          setNewStringOptions,
                          id,
                          value as string,
                          ''
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
              variant={canSubmit() ? 'accent' : 'ghost'}
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
