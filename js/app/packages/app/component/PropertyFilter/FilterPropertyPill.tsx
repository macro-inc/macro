import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils/PropertyDataTypeIcon';
import CheckIcon from '@phosphor-icons/core/assets/regular/check.svg';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { Component } from 'solid-js';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type { FilterAction, PropertyFilter } from '../PropertyFilterTypes';
import { ComparisonAction } from '../PropertyFilterTypes';
import { FilterActionSelect } from './FilterAction';
import { FilterPropertySelect } from './FilterProperty';
import { FilterValueBoolean } from './FilterValue';

type FilterPillProps = {
  id: string;
  savedData: PropertyFilter | null; // null = pending, non-null = saved
  onSave: (data: PropertyFilter) => void;
  onCancel: () => void;
};

export const FilterPropertyPill: Component<FilterPillProps> = (props) => {
  // Internal editing state
  const [selectedProperty, setSelectedProperty] =
    createSignal<PropertyDefinitionFlat | null>(null);
  const [action, setAction] = createSignal<FilterAction | null>(null);
  const [values, _setValues] = createSignal<string[]>([]);
  const [booleanValue, setBooleanValue] = createSignal<boolean | null>(null);

  // Track if user is editing property (to show search instead of pill)
  const [previousProperty, setPreviousProperty] =
    createSignal<PropertyDefinitionFlat | null>(null);

  const isPending = () => props.savedData === null;

  // Check if value is set based on data type
  const hasValue = () => {
    const property = selectedProperty();
    if (!property) return false;

    if (property.data_type === 'BOOLEAN') {
      return booleanValue() !== null;
    }
    return values().length > 0;
  };

  const canConfirm = () => selectedProperty() && action() && hasValue();

  const handleSelectProperty = (property: PropertyDefinitionFlat) => {
    // Only clear action/values if property actually changed
    const prev = previousProperty();
    if (prev && prev.id !== property.id) {
      setAction(null);
      setBooleanValue(null);
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

  const handleBooleanValueChange = (value: boolean) => {
    setBooleanValue(value);

    // Auto-save when value changes
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
    property: PropertyDefinitionFlat,
    filterAction: FilterAction,
    filterValues: string[] = []
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
            value: '',
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType: 'DATE',
          action: filterAction as any,
          values: filterValues,
        } as PropertyFilter;
      case 'NUMBER':
        if (isComparisonAction) {
          return {
            ...baseFilter,
            dataType: 'NUMBER',
            action: filterAction as any,
            value: 0,
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType: 'NUMBER',
          action: filterAction as any,
          values: filterValues.map(Number),
        } as PropertyFilter;
      case 'SELECT_NUMBER':
      case 'SELECT_STRING':
        if (isComparisonAction) {
          return {
            ...baseFilter,
            dataType,
            action: filterAction as any,
            value: '',
          } as PropertyFilter;
        }
        return {
          ...baseFilter,
          dataType,
          action: filterAction as any,
          values: filterValues,
        } as PropertyFilter;
      case 'ENTITY':
        return {
          ...baseFilter,
          dataType: 'ENTITY',
          action: filterAction as any,
          values: [],
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
      <div class="flex items-center gap-0.5">
        {/* Property pill */}
        <button
          type="button"
          onClick={handleStartEditProperty}
          class="h-6 px-2 text-[10px] text-ink border border-edge hover:bg-hover text-left flex items-center gap-1.5 font-mono cursor-pointer"
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
        <FilterActionSelect
          property={selectedProperty()!}
          selectedAction={action()}
          onSelectAction={handleSelectAction}
        />

        {/* Value input - only show after action is set */}
        <Show when={action()}>
          <Switch
            fallback={
              <button
                type="button"
                class="h-6 px-2 w-fit text-[10px] text-ink-muted border border-edge hover:bg-hover text-left cursor-pointer flex items-center"
              >
                {values().length > 0 ? values().join(', ') : '...'}
              </button>
            }
          >
            <Match when={selectedProperty()?.data_type === 'BOOLEAN'}>
              <FilterValueBoolean
                value={booleanValue()}
                onSelect={handleBooleanValueChange}
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
            class="h-6 w-6 flex items-center justify-center text-ink hover:bg-hover border border-edge cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckIcon class="size-4" />
          </button>
        </Show>

        {/* Cancel/Remove button */}
        <button
          type="button"
          onClick={props.onCancel}
          class="h-6 w-6 flex items-center justify-center text-ink hover:text-failure-ink hover:bg-hover cursor-pointer"
        >
          <XIcon class="size-3" />
        </button>
      </div>
    </Show>
  );
};

export default FilterPropertyPill;
