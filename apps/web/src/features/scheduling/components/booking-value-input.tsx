import { NumberUnitInput, Select } from '@ui';
import {
  batch,
  createMemo,
  createSignal,
  createUniqueId,
  Show,
} from 'solid-js';
import {
  automaticBookingUnit,
  type BookingValueUnit,
  bookingValueBounds,
  convertBookingValue,
  displayBookingValue,
  storedBookingValue,
} from '../core/booking-units';
import { FieldError } from './fields';

type UnitOption = { id: string; label: string; short: string };

/** Unit precision controls amounts; Auto preserves the stored minutes or days. */
export function BookingValueInput(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  units: readonly BookingValueUnit[];
  disabled: boolean;
  compact?: boolean;
  controls?: boolean;
  fullWidth?: boolean;
  variant?: 'outline' | 'bare';
  zeroLabel?: string;
  inputId?: string;
  onChange: (value: number) => void;
  onEdit?: () => void;
  inputRef?: (element: HTMLInputElement) => void;
  error?: string;
  errorId?: string;
  unitPreference?: string;
  onUnitPreference?: (unit: string) => void;
}) {
  const unitDescriptionId = createUniqueId();
  const generatedErrorId = createUniqueId();
  const errorId = () => props.errorId ?? generatedErrorId;
  const [localPreference, setLocalPreference] = createSignal('auto');
  const preference = () => props.unitPreference ?? localPreference();
  const setPreference = (unit: string) => {
    setLocalPreference(unit);
    props.onUnitPreference?.(unit);
  };
  const [editing, setEditing] = createSignal<{
    unit: BookingValueUnit;
    automatic: boolean;
    text: string;
  }>();
  const availableUnits = () =>
    props.units.filter((unit) => {
      const bounds = bookingValueBounds(props.min, props.max, unit);
      return bounds.min <= bounds.max;
    });
  const automaticUnit = () => automaticBookingUnit(props.value, props.units);
  const preferredUnit = () =>
    availableUnits().find((unit) => unit.id === preference());
  const fixedUnit = () => {
    const preferred = preferredUnit();
    // Whole units fall back to Auto when slider or preset edits need a fraction.
    return preferred &&
      Number.isFinite(props.value) &&
      ((preferred.decimalPlaces ?? 0) > 0 ||
        Number.isInteger(props.value / preferred.factor))
      ? preferred
      : undefined;
  };
  const currentUnit = () => editing()?.unit ?? fixedUnit() ?? automaticUnit();
  const automatic = () => editing()?.automatic ?? !fixedUnit();
  const bounds = () => bookingValueBounds(props.min, props.max, currentUnit());
  // Keep option identities stable so duplicate selection events only reflect user choices.
  const options = createMemo<UnitOption[]>(() => [
    { id: 'auto', label: 'Auto', short: 'Auto' },
    ...availableUnits(),
  ]);
  const selectedOption = () =>
    options().find(
      (option) => option.id === (automatic() ? 'auto' : currentUnit().id)
    );
  // Invalid stored fractions remain visible instead of looking like rounded valid values.
  const storedText = (unit: BookingValueUnit) =>
    Number.isFinite(props.value) && !Number.isInteger(props.value)
      ? props.value / unit.factor
      : displayBookingValue(props.value, unit);
  const changeText = (text: string) => {
    const unit = currentUnit();
    const auto = automatic();
    const amount = text.trim() === '' ? Number.NaN : Number(text);
    const value = storedBookingValue(amount, unit);
    batch(() => {
      setEditing({ unit, automatic: auto, text });
      if (
        Number.isFinite(value) &&
        value >= props.min &&
        value <= props.max &&
        value !== props.value
      ) {
        props.onChange(value);
      }
    });
  };
  const unitText = () => {
    const unit = currentUnit();
    const amount = editing()?.text ?? storedText(unit);
    return Number(amount) === 1 ? unit.short.replace(/s$/, '') : unit.short;
  };
  const controls = () => props.controls ?? !props.compact;
  const showZeroLabel = () =>
    !!props.zeroLabel && props.value === 0 && !editing();
  return (
    <div
      class={`flex max-w-full flex-col gap-1.5 ${props.fullWidth ? 'w-full' : 'items-start'}`}
    >
      <div
        class={
          props.fullWidth
            ? 'flex w-full min-w-0 items-center gap-2'
            : props.compact
              ? 'flex max-w-full flex-wrap items-center gap-1'
              : 'flex max-w-full items-center gap-2'
        }
      >
        <NumberUnitInput
          format={false}
          class={props.fullWidth ? 'w-full' : undefined}
          step={10 ** -(currentUnit().decimalPlaces ?? 0)}
          minValue={bounds().min}
          maxValue={bounds().max}
          required
          disabled={props.disabled}
          validationState={props.error ? 'invalid' : 'valid'}
          value={editing()?.text ?? storedText(currentUnit())}
          onChange={changeText}
        >
          <Show when={controls()}>
            <NumberUnitInput.Controls align="inline-start">
              <NumberUnitInput.DecrementTrigger
                size="icon-lg"
                class="rounded-lg"
                label={`Decrease ${props.label.toLowerCase()}`}
              />
            </NumberUnitInput.Controls>
          </Show>
          <NumberUnitInput.Frame
            variant={props.variant}
            class={props.fullWidth ? 'relative min-w-0 flex-1' : 'relative'}
          >
            <Show when={showZeroLabel()}>
              <span
                aria-hidden="true"
                class="pointer-events-none absolute inset-y-0 start-3 flex items-center text-base text-ink sm:text-sm"
                data-booking-zero-label
              >
                {props.zeroLabel}
              </span>
            </Show>
            <NumberUnitInput.Input
              ref={props.inputRef}
              id={props.inputId}
              class={`${
                props.fullWidth
                  ? 'w-0 min-w-0 flex-1 px-3 text-base sm:text-sm'
                  : 'px-3 text-base sm:text-sm'
              } ${showZeroLabel() ? 'text-transparent' : ''}`}
              aria-valuetext={props.value === 0 ? props.zeroLabel : undefined}
              aria-label={`${props.label} exact value`}
              aria-describedby={[
                unitDescriptionId,
                props.error ? errorId() : undefined,
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                props.fullWidth
                  ? undefined
                  : {
                      width: `calc(${Math.max(2, String(showZeroLabel() ? props.zeroLabel : (editing()?.text ?? storedText(currentUnit()))).length)}ch + 1.5rem)`,
                    }
              }
              onInput={() => props.onEdit?.()}
              onFocus={(event) =>
                setEditing({
                  unit: currentUnit(),
                  automatic: automatic(),
                  text: event.currentTarget.value,
                })
              }
              onBlur={() => setEditing(undefined)}
            />
            <NumberUnitInput.Unit>
              <Show when={!showZeroLabel()}>
                <Show when={props.units.length > 1} fallback={unitText()}>
                  <Select<UnitOption>
                    options={options()}
                    optionValue="id"
                    optionTextValue="label"
                    value={selectedOption()}
                    disabled={props.disabled}
                    modal={false}
                    allowDuplicateSelectionEvents
                    disallowEmptySelection
                    onChange={(option) => {
                      if (!option) return;
                      const unit = availableUnits().find(
                        (unit) => unit.id === option.id
                      );
                      const value = unit
                        ? convertBookingValue(
                            props.value,
                            unit,
                            props.min,
                            props.max
                          )
                        : props.value;
                      batch(() => {
                        setEditing(undefined);
                        setPreference(option.id);
                        if (Number.isFinite(value) && value !== props.value)
                          props.onChange(value);
                      });
                    }}
                  >
                    <Select.Trigger
                      {...{ role: 'combobox' }}
                      aria-label={`${props.label} units`}
                      class="h-full w-auto gap-1 rounded-none border-0 bg-transparent px-0 text-sm text-ink-muted focus-visible:ring-1 focus-visible:ring-edge-focus"
                    >
                      <span class="min-w-0 truncate">{unitText()}</span>
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Content portalScope="local" class="min-w-36">
                      <Select.Listbox />
                    </Select.Content>
                  </Select>
                </Show>
              </Show>
            </NumberUnitInput.Unit>
          </NumberUnitInput.Frame>
          <Show when={controls()}>
            <NumberUnitInput.Controls align="inline-end">
              <NumberUnitInput.IncrementTrigger
                size="icon-lg"
                class="rounded-lg"
                label={`Increase ${props.label.toLowerCase()}`}
              />
            </NumberUnitInput.Controls>
          </Show>
        </NumberUnitInput>
        <span id={unitDescriptionId} class="sr-only">
          Value in {currentUnit().label.toLowerCase()}. Values save in whole{' '}
          {props.units[0].label.toLowerCase()}. Amounts round to unit precision.
        </span>
      </div>
      <FieldError id={errorId()} message={props.error} />
    </div>
  );
}
