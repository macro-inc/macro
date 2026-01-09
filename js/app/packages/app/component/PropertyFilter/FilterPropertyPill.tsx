import { PropertyDataTypeIcon } from '@core/component/Properties/utils/PropertyDataTypeIcon';
import CheckIcon from '@phosphor-icons/core/assets/regular/check.svg';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { Component } from 'solid-js';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type {
  EntityFilterValue,
  FilterAction,
  PropertyFilter,
} from '../PropertyFilterTypes';
import { ComparisonAction } from '../PropertyFilterTypes';
import { FilterActionSelect } from './FilterAction';
import { FilterPropertySelect } from './FilterProperty';
import { FilterValueBoolean } from './FilterValueBoolean';
import { FilterValueDate } from './FilterValueDate';
import { FilterValueDateMulti } from './FilterValueDateMulti';
import { FilterValueEntity } from './FilterValueEntity';
import { FilterValueNumber } from './FilterValueNumber';
import { FilterValueNumberMulti } from './FilterValueNumberMulti';
import { FilterValueSelect } from './FilterValueSelect';
import { FilterValueSelectMulti } from './FilterValueSelectMulti';

type FilterPillProps = {
  id: string;
  savedData: PropertyFilter | null; // null = pending, non-null = saved
  onSave: (data: PropertyFilter) => void;
  onCancel: () => void;
};

export const FilterPropertyPill: Component<FilterPillProps> = (props) => {
  // Internal editing state
  const [selectedProperty, setSelectedProperty] =
    createSignal<PropertyDefinition | null>(null);
  const [action, setAction] = createSignal<FilterAction | null>(null);
  const [values, _setValues] = createSignal<string[]>([]);
  const [booleanValue, setBooleanValue] = createSignal<boolean | null>(null);
  const [dateValue, setDateValue] = createSignal<string | null>(null);
  const [dateValues, setDateValues] = createSignal<string[]>([]); // Multi-date for equality actions
  const [numberValue, setNumberValue] = createSignal<number | null>(null);
  const [numberValues, setNumberValues] = createSignal<number[]>([]); // Multi-number for equality actions
  const [selectValue, setSelectValue] = createSignal<string | null>(null); // option ID for SELECT types
  const [selectValues, setSelectValues] = createSignal<string[]>([]); // Multi-select for equality actions
  const [entityValues, setEntityValues] = createSignal<EntityFilterValue[]>([]); // Entity values for ENTITY type

  // Track if user is editing property (to show search instead of pill)
  const [previousProperty, setPreviousProperty] =
    createSignal<PropertyDefinition | null>(null);

  const isPending = () => props.savedData === null;

  // Helper to check if action is a comparison
  const isComparisonAction = (a: FilterAction | null) =>
    a === ComparisonAction.GREATER_THAN ||
    a === ComparisonAction.GREATER_THAN_OR_EQUAL ||
    a === ComparisonAction.LESS_THAN ||
    a === ComparisonAction.LESS_THAN_OR_EQUAL;

  // Check if value is set based on data type
  const hasValue = () => {
    const property = selectedProperty();
    if (!property) return false;

    if (property.data_type === 'BOOLEAN') {
      return booleanValue() !== null;
    }
    if (property.data_type === 'DATE') {
      if (isComparisonAction(action())) {
        return dateValue() !== null;
      }
      return dateValues().length > 0; // Equality actions use multi-date
    }
    if (property.data_type === 'NUMBER') {
      if (isComparisonAction(action())) {
        return numberValue() !== null;
      }
      return numberValues().length > 0; // Equality actions use multi-number
    }
    if (
      property.data_type === 'SELECT_STRING' ||
      property.data_type === 'SELECT_NUMBER'
    ) {
      if (isComparisonAction(action())) {
        return selectValue() !== null;
      }
      return selectValues().length > 0; // Equality actions use multi-select
    }
    if (property.data_type === 'ENTITY') {
      return entityValues().length > 0;
    }
    return values().length > 0;
  };

  const canConfirm = () => selectedProperty() && action() && hasValue();

  const handleSelectProperty = (property: PropertyDefinition) => {
    // Only clear action/values if property actually changed
    const prev = previousProperty();
    if (prev && prev.id !== property.id) {
      setAction(null);
      setBooleanValue(null);
      setDateValue(null);
      setDateValues([]);
      setNumberValue(null);
      setNumberValues([]);
      setSelectValue(null);
      setSelectValues([]);
      setEntityValues([]);
      _setValues([]);
    }
    setSelectedProperty(property);
    setPreviousProperty(null);
  };

  const handleStartEditProperty = () => {
    setPreviousProperty(selectedProperty());
    setSelectedProperty(null);
    // Don't clear action here - we might select the same property
  };

  const handleCancelEditProperty = () => {
    // Restore previous property if we were editing
    if (previousProperty()) {
      setSelectedProperty(previousProperty());
    }
    setPreviousProperty(null);
  };

  const handleSelectAction = (selectedAction: FilterAction) => {
    setAction(selectedAction);

    // Auto-save to store when action is selected
    const property = selectedProperty();
    if (property) {
      // Build partial filter with current values
      const filter = buildPartialFilter(property, selectedAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  const handleValueChange = (value: boolean | string | number) => {
    const property = selectedProperty();
    if (!property) return;

    // Set the appropriate value based on data type
    if (property.data_type === 'BOOLEAN' && typeof value === 'boolean') {
      setBooleanValue(value);
    } else if (property.data_type === 'DATE' && typeof value === 'string') {
      setDateValue(value);
    } else if (property.data_type === 'NUMBER' && typeof value === 'number') {
      setNumberValue(value);
    } else if (
      (property.data_type === 'SELECT_STRING' ||
        property.data_type === 'SELECT_NUMBER') &&
      typeof value === 'string'
    ) {
      setSelectValue(value);
    }

    // Auto-save when value changes
    const currentAction = action();
    if (currentAction) {
      const filter = buildPartialFilter(property, currentAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  // Handler for multi-date values
  const handleDateValuesChange = (newValues: string[]) => {
    setDateValues(newValues);

    // Auto-save when values change
    const property = selectedProperty();
    const currentAction = action();
    if (property && currentAction) {
      const filter = buildPartialFilter(property, currentAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  // Handler for multi-number values
  const handleNumberValuesChange = (newValues: number[]) => {
    setNumberValues(newValues);

    // Auto-save when values change
    const property = selectedProperty();
    const currentAction = action();
    if (property && currentAction) {
      const filter = buildPartialFilter(property, currentAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  // Handler for multi-select values
  const handleSelectValuesChange = (newValues: string[]) => {
    setSelectValues(newValues);

    // Auto-save when values change
    const property = selectedProperty();
    const currentAction = action();
    if (property && currentAction) {
      const filter = buildPartialFilter(property, currentAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  // Handler for entity values
  const handleEntityValuesChange = (newValues: EntityFilterValue[]) => {
    setEntityValues(newValues);

    // Auto-save when values change
    const property = selectedProperty();
    const currentAction = action();
    if (property && currentAction) {
      const filter = buildPartialFilter(property, currentAction);
      if (filter) {
        props.onSave(filter);
      }
    }
  };

  const handleConfirm = () => {
    if (!canConfirm()) return;
    const property = selectedProperty();
    const currentAction = action();
    if (!property || !currentAction) return;

    // Build filter with actual values
    const filter = buildPartialFilter(property, currentAction, values());
    if (filter) {
      props.onSave(filter);
    }
  };

  // Build a PropertyFilter from the current state
  const buildPartialFilter = (
    property: PropertyDefinition,
    filterAction: FilterAction,
    _filterValues: string[] = []
  ): PropertyFilter | null => {
    const dataType = property.data_type;
    const baseFilter = {
      propertyId: property.id,
      action: filterAction,
    };

    const isComparisonAction =
      filterAction === ComparisonAction.GREATER_THAN ||
      filterAction === ComparisonAction.GREATER_THAN_OR_EQUAL ||
      filterAction === ComparisonAction.LESS_THAN ||
      filterAction === ComparisonAction.LESS_THAN_OR_EQUAL;

    // Build filter based on data type
    switch (dataType) {
      case 'BOOLEAN':
        return {
          ...baseFilter,
          dataType: 'BOOLEAN',
          action: filterAction as any,
          value: booleanValue() ?? false,
        } as PropertyFilter;
      case 'DATE':
        if (isComparisonAction) {
          return {
            ...baseFilter,
            dataType: 'DATE',
            action: filterAction as any,
            value: dateValue() ?? '',
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType: 'DATE',
          action: filterAction as any,
          values: dateValues(), // Use dateValues signal for equality actions
        } as PropertyFilter;
      case 'NUMBER':
        if (isComparisonAction) {
          return {
            ...baseFilter,
            dataType: 'NUMBER',
            action: filterAction as any,
            value: numberValue() ?? 0,
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType: 'NUMBER',
          action: filterAction as any,
          values: numberValues(), // Use numberValues signal for equality actions
        } as PropertyFilter;
      case 'SELECT_NUMBER':
      case 'SELECT_STRING':
        if (isComparisonAction) {
          return {
            ...baseFilter,
            dataType,
            action: filterAction as any,
            value: selectValue() ?? '',
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType,
          action: filterAction as any,
          values: selectValues(), // Use selectValues signal for equality actions
        } as PropertyFilter;
      case 'ENTITY':
        return {
          ...baseFilter,
          dataType: 'ENTITY',
          action: filterAction as any,
          values: entityValues(),
        } as PropertyFilter;
      default:
        return null;
    }
  };

  return (
    <Show
      when={selectedProperty()}
      fallback={
        <div class="flex items-center gap-0.5 w-full">
          <FilterPropertySelect
            onSelectProperty={handleSelectProperty}
            onCancel={handleCancelEditProperty}
          />
          {/* Cancel/Remove button */}
          <button
            type="button"
            onClick={props.onCancel}
            class="h-6 w-6 flex items-center justify-center text-ink hover:text-failure-ink hover:bg-hover cursor-pointer"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      }
    >
      <div class="flex items-start gap-0.5">
        {/* Property pill */}
        <button
          type="button"
          onClick={handleStartEditProperty}
          class="h-6 px-2 text-[10px] text-ink border border-edge hover:bg-hover text-left flex items-center gap-1.5 font-mono cursor-pointer shrink-0"
        >
          <PropertyDataTypeIcon
            property={selectedProperty()!}
            class="size-3.5 shrink-0"
          />
          <span class="truncate max-w-[120px]">
            {selectedProperty()!.display_name}
          </span>
        </button>

        {/* Action dropdown */}
        <div class="shrink-0">
          <FilterActionSelect
            property={selectedProperty()!}
            selectedAction={action()}
            onSelectAction={handleSelectAction}
          />
        </div>

        {/* Value input - only show after action is set */}
        <Show when={action()}>
          <Switch
            fallback={
              <button
                type="button"
                class="h-6  px-2 w-fit text-[10px] text-ink-muted font-mono border border-edge hover:bg-hover text-left cursor-pointer flex items-center"
              >
                {values().length > 0 ? values().join(', ') : '...'}
              </button>
            }
          >
            <Match when={selectedProperty()?.data_type === 'BOOLEAN'}>
              <FilterValueBoolean
                value={booleanValue()}
                onSelect={handleValueChange}
              />
            </Match>
            <Match
              when={
                selectedProperty()?.data_type === 'DATE' &&
                isComparisonAction(action())
              }
            >
              <FilterValueDate
                value={dateValue()}
                onChange={handleValueChange}
              />
            </Match>
            <Match
              when={
                selectedProperty()?.data_type === 'DATE' &&
                !isComparisonAction(action())
              }
            >
              <FilterValueDateMulti
                values={dateValues()}
                onChange={handleDateValuesChange}
              />
            </Match>
            <Match
              when={
                selectedProperty()?.data_type === 'NUMBER' &&
                isComparisonAction(action())
              }
            >
              <FilterValueNumber
                value={numberValue()}
                onChange={handleValueChange}
              />
            </Match>
            <Match
              when={
                selectedProperty()?.data_type === 'NUMBER' &&
                !isComparisonAction(action())
              }
            >
              <FilterValueNumberMulti
                values={numberValues()}
                onChange={handleNumberValuesChange}
              />
            </Match>
            <Match
              when={
                (selectedProperty()?.data_type === 'SELECT_STRING' ||
                  selectedProperty()?.data_type === 'SELECT_NUMBER') &&
                isComparisonAction(action())
              }
            >
              <FilterValueSelect
                propertyId={selectedProperty()!.id}
                dataType={
                  selectedProperty()!.data_type as
                    | 'SELECT_STRING'
                    | 'SELECT_NUMBER'
                }
                value={selectValue()}
                onChange={handleValueChange}
              />
            </Match>
            <Match
              when={
                (selectedProperty()?.data_type === 'SELECT_STRING' ||
                  selectedProperty()?.data_type === 'SELECT_NUMBER') &&
                !isComparisonAction(action())
              }
            >
              <FilterValueSelectMulti
                propertyId={selectedProperty()!.id}
                dataType={
                  selectedProperty()!.data_type as
                    | 'SELECT_STRING'
                    | 'SELECT_NUMBER'
                }
                values={selectValues()}
                onChange={handleSelectValuesChange}
              />
            </Match>
            <Match when={selectedProperty()?.data_type === 'ENTITY'}>
              <FilterValueEntity
                specificEntityType={selectedProperty()!.specific_entity_type!}
                values={entityValues()}
                onChange={handleEntityValuesChange}
              />
            </Match>
          </Switch>
        </Show>

        {/* Confirm button - only show when pending and all fields filled */}
        <Show when={action() && hasValue() && isPending()}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm()}
            class="h-6 w-6 flex items-center justify-center text-ink hover:bg-hover border border-edge cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <CheckIcon class="size-4" />
          </button>
        </Show>

        {/* Cancel/Remove button */}
        <button
          type="button"
          onClick={props.onCancel}
          class="h-6 w-6 flex items-center justify-center text-ink hover:text-failure-ink hover:bg-hover cursor-pointer shrink-0"
        >
          <XIcon class="size-3" />
        </button>
      </div>
    </Show>
  );
};

export default FilterPropertyPill;
