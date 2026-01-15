import type { PropertyDefinitionDomain } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils/PropertyDataTypeIcon';
import CheckIcon from '@phosphor-icons/core/assets/regular/check.svg';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { Component } from 'solid-js';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type {
  EntityFilterValue,
  FilterAction,
  PropertyFilter,
} from '../PropertyFilterTypes';
import {
  ComparisonAction,
  ContainsAction,
  EqualityAction,
} from '../PropertyFilterTypes';

// Type guards for action types
const isEqualityAction = (a: FilterAction): a is EqualityAction =>
  a === EqualityAction.EQUAL || a === EqualityAction.NOT_EQUAL;

const isComparisonActionType = (a: FilterAction): a is ComparisonAction =>
  a === ComparisonAction.GREATER_THAN ||
  a === ComparisonAction.GREATER_THAN_OR_EQUAL ||
  a === ComparisonAction.LESS_THAN ||
  a === ComparisonAction.LESS_THAN_OR_EQUAL;

const isContainsAction = (a: FilterAction): a is ContainsAction =>
  a === ContainsAction.HAS_ANY ||
  a === ContainsAction.HAS_ALL ||
  a === ContainsAction.DOES_NOT_HAVE;
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
  /** Property definition for restoring saved filters (looked up by parent) */
  initialProperty?: PropertyDefinitionDomain;
  onSave: (data: PropertyFilter) => void;
  onCancel: () => void;
};

export const FilterPropertyPill: Component<FilterPillProps> = (props) => {
  // Initialize state from savedData if available
  const initBooleanValue = (): boolean | null => {
    if (props.savedData?.dataType === 'BOOLEAN' && 'value' in props.savedData) {
      return props.savedData.value as boolean;
    }
    return null;
  };

  const initDateValue = (): string | null => {
    if (props.savedData?.dataType === 'DATE' && 'value' in props.savedData) {
      return props.savedData.value as string;
    }
    return null;
  };

  const initDateValues = (): string[] => {
    if (props.savedData?.dataType === 'DATE' && 'values' in props.savedData) {
      return props.savedData.values as string[];
    }
    return [];
  };

  const initNumberValue = (): number | null => {
    if (props.savedData?.dataType === 'NUMBER' && 'value' in props.savedData) {
      return props.savedData.value as number;
    }
    return null;
  };

  const initNumberValues = (): number[] => {
    if (props.savedData?.dataType === 'NUMBER' && 'values' in props.savedData) {
      return props.savedData.values as number[];
    }
    return [];
  };

  const initSelectValue = (): string | null => {
    if (
      (props.savedData?.dataType === 'SELECT_STRING' ||
        props.savedData?.dataType === 'SELECT_NUMBER') &&
      'value' in props.savedData
    ) {
      return String(props.savedData.value);
    }
    return null;
  };

  const initSelectValues = (): string[] => {
    if (
      (props.savedData?.dataType === 'SELECT_STRING' ||
        props.savedData?.dataType === 'SELECT_NUMBER') &&
      'values' in props.savedData
    ) {
      return (props.savedData.values as (string | number)[]).map(String);
    }
    return [];
  };

  const initEntityValues = (): EntityFilterValue[] => {
    if (props.savedData?.dataType === 'ENTITY' && 'values' in props.savedData) {
      return props.savedData.values as EntityFilterValue[];
    }
    return [];
  };

  // Internal editing state - initialized from props
  const [selectedProperty, setSelectedProperty] =
    createSignal<PropertyDefinitionDomain | null>(
      props.initialProperty ?? null
    );
  const [action, setAction] = createSignal<FilterAction | null>(
    props.savedData?.action ?? null
  );
  const [values, _setValues] = createSignal<string[]>([]);
  const [booleanValue, setBooleanValue] = createSignal<boolean | null>(
    initBooleanValue()
  );
  const [dateValue, setDateValue] = createSignal<string | null>(
    initDateValue()
  );
  const [dateValues, setDateValues] = createSignal<string[]>(initDateValues());
  const [numberValue, setNumberValue] = createSignal<number | null>(
    initNumberValue()
  );
  const [numberValues, setNumberValues] = createSignal<number[]>(
    initNumberValues()
  );
  const [selectValue, setSelectValue] = createSignal<string | null>(
    initSelectValue()
  );
  const [selectValues, setSelectValues] = createSignal<string[]>(
    initSelectValues()
  );
  const [entityValues, setEntityValues] = createSignal<EntityFilterValue[]>(
    initEntityValues()
  );

  // Track if user is editing property (to show search instead of pill)
  const [previousProperty, setPreviousProperty] =
    createSignal<PropertyDefinitionDomain | null>(null);

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

    if (property.valueType === 'BOOLEAN') {
      return booleanValue() !== null;
    }
    if (property.valueType === 'DATE') {
      if (isComparisonAction(action())) {
        return dateValue() !== null;
      }
      return dateValues().length > 0; // Equality actions use multi-date
    }
    if (property.valueType === 'NUMBER') {
      if (isComparisonAction(action())) {
        return numberValue() !== null;
      }
      return numberValues().length > 0; // Equality actions use multi-number
    }
    if (
      property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER'
    ) {
      if (isComparisonAction(action())) {
        return selectValue() !== null;
      }
      return selectValues().length > 0; // Equality actions use multi-select
    }
    if (property.valueType === 'ENTITY') {
      return entityValues().length > 0;
    }
    return values().length > 0;
  };

  const canConfirm = () => selectedProperty() && action() && hasValue();

  const handleSelectProperty = (property: PropertyDefinitionDomain) => {
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
    if (property.valueType === 'BOOLEAN' && typeof value === 'boolean') {
      setBooleanValue(value);
    } else if (property.valueType === 'DATE' && typeof value === 'string') {
      setDateValue(value);
    } else if (property.valueType === 'NUMBER' && typeof value === 'number') {
      setNumberValue(value);
    } else if (
      (property.valueType === 'SELECT_STRING' ||
        property.valueType === 'SELECT_NUMBER') &&
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
    property: PropertyDefinitionDomain,
    filterAction: FilterAction,
    _filterValues: string[] = []
  ): PropertyFilter | null => {
    const dataType = property.valueType;
    const propertyId = property.id;

    switch (dataType) {
      case 'BOOLEAN':
        if (!isEqualityAction(filterAction)) return null;
        return {
          propertyId,
          dataType: 'BOOLEAN',
          action: filterAction,
          value: booleanValue() ?? false,
        };
      case 'DATE':
        if (isComparisonActionType(filterAction)) {
          return {
            propertyId,
            dataType: 'DATE',
            action: filterAction,
            value: dateValue() ?? '',
          };
        }
        if (isEqualityAction(filterAction)) {
          return {
            propertyId,
            dataType: 'DATE',
            action: filterAction,
            values: dateValues(),
          };
        }
        return null;
      case 'NUMBER':
        if (isComparisonActionType(filterAction)) {
          return {
            propertyId,
            dataType: 'NUMBER',
            action: filterAction,
            value: numberValue() ?? 0,
          };
        }
        if (isEqualityAction(filterAction)) {
          return {
            propertyId,
            dataType: 'NUMBER',
            action: filterAction,
            values: numberValues(),
          };
        }
        return null;
      case 'SELECT_NUMBER':
      case 'SELECT_STRING':
        if (isComparisonActionType(filterAction)) {
          return {
            propertyId,
            dataType,
            action: filterAction,
            value: selectValue() ?? '',
          };
        }
        if (isEqualityAction(filterAction)) {
          return {
            propertyId,
            dataType,
            action: filterAction,
            values: selectValues(),
          };
        }
        if (isContainsAction(filterAction)) {
          return {
            propertyId,
            dataType,
            action: filterAction,
            values: selectValues(),
          };
        }
        return null;
      case 'ENTITY':
        if (isEqualityAction(filterAction)) {
          return {
            propertyId,
            dataType: 'ENTITY',
            action: filterAction,
            values: entityValues(),
          };
        }
        if (isContainsAction(filterAction)) {
          return {
            propertyId,
            dataType: 'ENTITY',
            action: filterAction,
            values: entityValues(),
          };
        }
        return null;
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
            class="h-6 w-6 flex items-center justify-center text-ink hover:text-failure-ink hover:bg-hover"
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
          class="h-6 px-2 text-xxs text-ink border border-edge hover:bg-hover text-left flex items-center gap-1.5 font-mono shrink-0"
        >
          <PropertyDataTypeIcon
            property={selectedProperty()!}
            class="size-3.5 shrink-0"
          />
          <span class="truncate max-w-[120px]">
            {selectedProperty()!.displayName}
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
                class="h-6  px-2 w-fit text-xxs text-ink-muted font-mono border border-edge hover:bg-hover text-left flex items-center"
              >
                {values().length > 0 ? values().join(', ') : '...'}
              </button>
            }
          >
            <Match when={selectedProperty()?.valueType === 'BOOLEAN'}>
              <FilterValueBoolean
                value={booleanValue()}
                onSelect={handleValueChange}
              />
            </Match>
            <Match
              when={
                selectedProperty()?.valueType === 'DATE' &&
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
                selectedProperty()?.valueType === 'DATE' &&
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
                selectedProperty()?.valueType === 'NUMBER' &&
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
                selectedProperty()?.valueType === 'NUMBER' &&
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
                (selectedProperty()?.valueType === 'SELECT_STRING' ||
                  selectedProperty()?.valueType === 'SELECT_NUMBER') &&
                isComparisonAction(action())
              }
            >
              <FilterValueSelect
                propertyId={selectedProperty()!.id}
                dataType={
                  selectedProperty()!.valueType as
                    | 'SELECT_STRING'
                    | 'SELECT_NUMBER'
                }
                value={selectValue()}
                onChange={handleValueChange}
              />
            </Match>
            <Match
              when={
                (selectedProperty()?.valueType === 'SELECT_STRING' ||
                  selectedProperty()?.valueType === 'SELECT_NUMBER') &&
                !isComparisonAction(action())
              }
            >
              <FilterValueSelectMulti
                propertyId={selectedProperty()!.id}
                dataType={
                  selectedProperty()!.valueType as
                    | 'SELECT_STRING'
                    | 'SELECT_NUMBER'
                }
                values={selectValues()}
                onChange={handleSelectValuesChange}
              />
            </Match>
            <Match when={selectedProperty()?.valueType === 'ENTITY'}>
              <FilterValueEntity
                specificEntityType={selectedProperty()!.specificEntityType!}
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
            class="h-6 w-6 flex items-center justify-center text-ink hover:bg-hover border border-edge disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <CheckIcon class="size-4" />
          </button>
        </Show>

        {/* Cancel/Remove button */}
        <button
          type="button"
          onClick={props.onCancel}
          class="h-6 w-6 flex items-center justify-center text-ink hover:text-failure-ink hover:bg-hover shrink-0"
        >
          <XIcon class="size-3" />
        </button>
      </div>
    </Show>
  );
};

export default FilterPropertyPill;
